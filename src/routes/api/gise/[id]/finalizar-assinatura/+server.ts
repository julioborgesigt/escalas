/**
 * POST /api/gise/[id]/finalizar-assinatura
 *
 * Finaliza a assinatura digital (PKCS#7) no PDF da GISE.
 * Salva o documento no R2 e registra no banco de dados.
 */

import type { RequestHandler } from './$types';
import forge from 'node-forge';
import { getDB, buscarGiseEscala, salvarGiseDocumento, atualizarGiseEscala } from '$lib/db';
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

	const ip = getClientAddress();
	const ua = request.headers.get('user-agent') || '';

	const id = parseInt(params.id!);
	if (isNaN(id)) return badRequest('ID inválido');

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
		dia,
		latitude,
		longitude,
		documentHash: documentHashOriginal,
		assinanteEmail
	} = validated.data;

	try {
		const gise = await buscarGiseEscala(db, id);
		if (!gise) return notFound('GISE');

		// Mesma regra do preparar-assinatura: somente admin ou supervisor designado pode finalizar.
		// Sem isto, qualquer membro de equipe poderia chamar finalizar com um preparedPdf
		// arbitrário (e até com seu próprio token A3) e produzir um documento "assinado".
		if (u.tipo !== 'admin' && gise.supervisor_id !== u.id) {
			return forbidden('Apenas o supervisor designado ou administradores podem finalizar esta escala');
		}

		const diaFinal = dia || 'ambos';

		// Finalizar o PDF (assinado)
		const pdfBytesInput = new Uint8Array(Buffer.from(preparedPdf, 'base64'));
		// Validar Certificado (Token) vs Usuário Logado
		let dadosToken: { nome: string; cpf: string } | null = null;
		if (serproCms) {
			dadosToken = extrairDadosCertificado(serproCms);
		} else if (certificateBase64) {
			// Em caso de PKI antigo (manual)
			const der = forge.util.decode64(certificateBase64);
			const cert = forge.pki.certificateFromAsn1(forge.asn1.fromDer(der));
			// Simplificado: extrai CN e CPF
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

			if (cpfLogado && cpfToken !== cpfLogado) {
				return badRequest('O token não pertence ao usuário logado (CPF incompatível).');
			}
			if (nomeLogado && nomeToken !== nomeLogado) {
				// Permite uma margem de manobra se o CPF bater, mas se ambos falharem, bloqueia
				if (!cpfLogado) {
					return badRequest('O token não pertence ao usuário logado (Nome incompatível).');
				}
			}
		}

		let signedPdfBytes: Uint8Array;
		if (serproCms) {
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
		const documentHash = Array.from(new Uint8Array(hashBuffer))
			.map(b => b.toString(16).padStart(2, '0'))
			.join('');

		// Salvar no R2 — preferindo o PDF com DSS embarcado (PAdES-LT).
		const [yyyy, mm, dd_escala] = gise.data_inicio.split('-');
		const mesAno = `${yyyy}-${mm}`;
		const folder = `gise/${mesAno}/${dd_escala}/${id}/escala`;

		const documentKey = `${folder}/gise_${id}_${verificationHash}_assinada.pdf`;
		const r2 = getR2(p);
		if (r2) {
			await r2.put(documentKey, verif.pdfFinal, {
				contentType: 'application/pdf'
			});
		}

		// Registrar no banco com auditoria
		const finalSignerName = verif.signerName || dadosToken?.nome || u.nome;
		const finalSignerCpf = verif.signerCpf || dadosToken?.cpf || u.cpf || '';
		await salvarGiseDocumento(
			db,
			id,
			documentKey,
			u.id,
			finalSignerName,
			finalSignerCpf,
			verificationHash,
			undefined,
			ip,
			ua,
			latitude,
			longitude,
			undefined, // selfieKey
			// Hash do PDF original (recebido do preparar-assinatura)
			documentHashOriginal || documentHash,
			assinanteEmail,
			tipoCarimboTempo,
			verif.metadata
		);

		// Avançar status para andamento
		await atualizarGiseEscala(db, id, { status: 'em_andamento' });

		return new Response(verif.pdfFinal as unknown as BodyInit, {
			headers: {
				'Content-Type': 'application/pdf',
				'Content-Disposition': contentDisposition(documentKey)
			}
		});
	} catch (err) {
		return serverError(`[gise/finalizar-assinatura] Falha (giseId=${id})`, err);
	}
};
