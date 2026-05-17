/**
 * POST /api/gise/[id]/relatorios/[seccionalId]/finalizar-assinatura
 *
 * Finaliza a assinatura digital (PKCS#7) no PDF do Relatório Extraordinário (GISE).
 * Retorna o PDF assinado como bytes binários.
 */

import type { RequestHandler } from './$types';
import forge from 'node-forge';
import {
	getDB,
	salvarAssinaturaRelatorioGise,
	buscarGiseEscala,
	tentarPromoverGiseProntaParaFinalizar
} from '$lib/db';
import { finalizarAssinaturaGiseSchema } from '$lib/schemas';
import { finalizarAssinatura, embedSerproCms, extrairDadosCertificado } from '$lib/server/pdf-signing';
import { normalizarTexto } from '$lib/utils';
import { getR2 } from '$lib/server/platform';
import { verificarECarimbarAssinatura } from '$lib/server/cades-finalizer';
import {
	apiError,
	ErrorCode,
	contentDisposition,
	requireAuth,
	badRequest,
	notFound,
	forbidden,
	serverError,
	validateBody
} from '$lib/server/api';

export const POST: RequestHandler = async ({ platform, params, locals, request, getClientAddress }) => {
	const p = platform as App.Platform | undefined;
	const db = getDB(p);
	const u = requireAuth(locals);
	if (u instanceof Response) return u;
	if (u.tipo !== 'policial' && u.tipo !== 'admin') {
		return forbidden('Somente policiais supervisores ou administradores podem assinar');
	}

	const ip = getClientAddress();
	const ua = request.headers.get('user-agent') || '';

	const id = parseInt(params.id!);
	const secIdNum = parseInt(params.seccionalId!);

	if (isNaN(id) || isNaN(secIdNum)) return badRequest('Parâmetros inválidos');

	// Mesma regra do preparar-assinatura: somente admin ou supervisor designado pode finalizar.
	// Sem isto, qualquer membro de equipe poderia chamar finalizar com um preparedPdf
	// arbitrário e produzir um relatório "assinado" como se fosse o supervisor.
	const giseAuth = await buscarGiseEscala(db, id);
	if (!giseAuth) return notFound('GISE');
	if (u.tipo !== 'admin' && giseAuth.supervisor_id !== u.id) {
		return forbidden('Apenas o supervisor designado ou administradores podem assinar este relatório');
	}

	const validated = await validateBody(request, finalizarAssinaturaGiseSchema);
	if (!validated.ok) return validated.response;
	const {
		preparedPdf,
		rawSignature,
		serproCms,
		certificateBase64,
		messageDigest,
		signingTimeISO,
		verificationHash,
		latitude,
		longitude,
		rubrica,
		documentHash: documentHashOriginal,
		assinanteEmail
	} = validated.data;

	try {
		const pdfBytesInput = new Uint8Array(Buffer.from(preparedPdf, 'base64'));

		// Validar Certificado (Token) vs Usuário Logado
		let dadosToken: { nome: string; cpf: string } | null = null;
		if (serproCms) {
			dadosToken = extrairDadosCertificado(serproCms);
		} else if (certificateBase64) {
			const der = forge.util.decode64(certificateBase64);
			const cert = forge.pki.certificateFromAsn1(forge.asn1.fromDer(der));
			const cn = cert.subject.getField('CN')?.value as string || '';
			const sn = cert.subject.getField('serialNumber')?.value as string || '';
			dadosToken = {
				nome: cn.split(':')[0].trim(),
				cpf: sn.replace(/\D/g, '').slice(-11) || cn.split(':').pop()?.replace(/\D/g, '').slice(-11) || ''
			};
		}

		if (dadosToken) {
			const nomeLogado = normalizarTexto(u.nome);
			const nomeToken = normalizarTexto(dadosToken.nome);
			const cpfLogado = u.cpf || '';
			const cpfToken = dadosToken.cpf;

			// Sessão sem CPF cadastrado NÃO pode assinar com certificado de
			// terceiro. Antes, `if (cpfLogado && ...)` silenciava a checagem
			// quando o usuário logado não tinha CPF — bastava o nome bater
			// por coincidência (após normalização) para o token alheio passar.
			if (!cpfLogado) {
				return badRequest(
					'Seu cadastro não possui CPF — não é possível validar a propriedade do certificado. Contate o administrador.'
				);
			}
			if (cpfToken !== cpfLogado) {
				return badRequest('O token não pertence ao usuário logado (CPF incompatível).');
			}
			if (nomeLogado && nomeToken !== nomeLogado) {
				return badRequest('O token não pertence ao usuário logado (Nome incompatível).');
			}
		}

		let signedPdfBytes: Uint8Array;
		let type: 'webpki' | 'serpro' = 'webpki';

		if (serproCms) {
			type = 'serpro';
			signedPdfBytes = await embedSerproCms(pdfBytesInput, serproCms);
		} else {
			// Sem SERPRO CMS, exigimos os campos do fluxo Web PKI.
			if (!rawSignature || !certificateBase64 || !messageDigest || !signingTimeISO) {
				return badRequest(
					'Faltam campos do fluxo Web PKI (rawSignature, certificateBase64, messageDigest, signingTimeISO)'
				);
			}
			signedPdfBytes = await finalizarAssinatura(
				pdfBytesInput,
				rawSignature,
				certificateBase64,
				messageDigest,
				signingTimeISO
			);
		}

		// Validação criptográfica + OCSP + extração de metadados (CAdES-LT).
		const verif = await verificarECarimbarAssinatura(signedPdfBytes);
		if (!verif.ok) {
			const code = verif.status >= 500 ? ErrorCode.UPSTREAM : ErrorCode.VALIDATION;
			return apiError(verif.error, verif.status, code);
		}
		const tipoCarimboTempo = verif.tipoCarimboTempo;

		// Calcular Hash do documento assinado (para controle no banco)
		const hashBuffer = await crypto.subtle.digest('SHA-256', signedPdfBytes.slice());
		const arquivo_hash = Array.from(new Uint8Array(hashBuffer))
			.map(b => b.toString(16).padStart(2, '0'))
			.join('');

		const gise = giseAuth;
		const [yyyy, mm, dd_escala] = gise.data_inicio.split('-');
		const mesAno = `${yyyy}-${mm}`;
		const folder = `gise/${mesAno}/${dd_escala}/${id}/relatorios_extra`;

		const r2Key = `${folder}/gise_rel_${id}_sec_${secIdNum}_${verificationHash}_assinada.pdf`;
		const filename = `relatorio_extraordinario_gise_${id}_sec_${secIdNum}.pdf`;

		const r2 = getR2(p);
		if (r2) {
			await r2.put(r2Key, verif.pdfFinal, { contentType: 'application/pdf' });
		}

		await salvarAssinaturaRelatorioGise(db, {
			gise_id: id,
			seccional_id: secIdNum,
			tipo: 'extraordinario',
			assinante_id: u.tipo === 'policial' ? u.id : null,
			assinante_nome: verif.signerName || dadosToken?.nome || u.nome,
			assinante_cpf: verif.signerCpf || dadosToken?.cpf || u.cpf || null,
			tipo_assinatura: type,
			rubrica: rubrica,
			verification_hash: verificationHash,
			ip_address: ip,
			user_agent: ua,
			latitude,
			longitude,
			selfie_key: undefined,
			r2_key: r2Key,
			arquivo_hash: documentHashOriginal || arquivo_hash, // Preferimos o hash do PDF original para auditoria
			assinante_email: assinanteEmail ?? u.email,
			tipo_carimbo_tempo: tipoCarimboTempo,
			cert_issuer: verif.metadata.cert_issuer,
			cert_serial: verif.metadata.cert_serial,
			cert_valido_de: verif.metadata.cert_valido_de,
			cert_valido_ate: verif.metadata.cert_valido_ate,
			cms_sha256: verif.metadata.cms_sha256,
			ocsp_response_b64: verif.metadata.ocsp_response_b64,
			ocsp_consultado_em: verif.metadata.ocsp_consultado_em,
			tst_token_b64: verif.metadata.tst_token_b64
		});

		await tentarPromoverGiseProntaParaFinalizar(db, id);

		// Retorna o PDF assinado como bytes binários
		return new Response(verif.pdfFinal as unknown as BodyInit, {
			headers: {
				'Content-Type': 'application/pdf',
				'Content-Disposition': contentDisposition(filename)
			}
		});
	} catch (err) {
		return serverError(`[gise/relatorios/finalizar-assinatura] Falha (gise_id=${id}, seccional_id=${secIdNum})`, err);
	}
};
