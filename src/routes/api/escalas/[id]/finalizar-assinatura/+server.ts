import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	apiError,
	ErrorCode,
	requireAuth,
	badRequest,
	notFound,
	forbidden,
	serverError,
	validateBody
} from '$lib/server/api';
import { getDB, getR2, hasR2, buscarEscala, salvarDocumentoEscala, registrarAuditComContexto } from '$lib/db';
import { finalizarAssinaturaEscalasSchema } from '$lib/schemas';
import { finalizarAssinatura, embedSerproCms, extrairDadosCertificado } from '$lib/server/pdf-signing';
import { verificarECarimbarAssinatura } from '$lib/server/cades-finalizer';
import { verificarPermissaoEscala } from '$lib/server/escala-permissao';
import { normalizarTexto } from '$lib/utils';

export const POST: RequestHandler = async ({ platform, params, locals, request, getClientAddress }) => {
	const u = requireAuth(locals);
	if (u instanceof Response) return u;

	const ip = getClientAddress();
	const ua = request.headers.get('user-agent') || '';

	const validated = await validateBody(request, finalizarAssinaturaEscalasSchema);
	if (!validated.ok) return validated.response;
	const {
		preparedPdf,
		signature,
		certificate,
		serproCms,
		verificationHash,
		signingTimeISO,
		messageDigestHex,
		documentHash,
		assinanteEmail,
		latitude,
		longitude
	} = validated.data;

	const id = parseInt(params.id!);
	if (isNaN(id)) return badRequest('ID inválido');

	const db = getDB(platform);
	const escala = await buscarEscala(db, id);
	if (!escala) return notFound('Escala');

	// Mesma regra do preparar-assinatura: somente admin, dono da lotação ou DPC admin
	// com solicitação direcionada pode finalizar.
	const perm = await verificarPermissaoEscala(db, id, escala.lotacao, u);
	if (!perm.permitido) return forbidden(perm.motivo ?? 'Sem permissão para assinar esta escala');

	try {
		const preparedPdfBytes = Buffer.from(preparedPdf, 'base64');
		let signedPdf: Uint8Array;

		let nomeAssinante = u.nome;
		let cpfAssinante = u.cpf || '';

		let dadosToken: { nome: string; cpf: string } | null = null;
		if (serproCms) {
			signedPdf = await embedSerproCms(preparedPdfBytes, serproCms);
			dadosToken = extrairDadosCertificado(serproCms);
			nomeAssinante = dadosToken.nome;
			cpfAssinante = dadosToken.cpf;
		} else {
			// Sem SERPRO CMS, exigimos os 4 campos do fluxo Web PKI (signature + certificate
			// + messageDigest + signingTime). Antes a ausência crashava em runtime; agora
			// devolvemos 400 com mensagem clara.
			if (!signature || !certificate || !messageDigestHex || !signingTimeISO) {
				return badRequest(
					'Faltam campos do fluxo Web PKI (signature, certificate, messageDigestHex, signingTimeISO)'
				);
			}
			signedPdf = await finalizarAssinatura(
				preparedPdfBytes,
				signature,
				certificate,
				messageDigestHex,
				signingTimeISO
			);
			dadosToken = extrairDadosCertificado(certificate);
			nomeAssinante = dadosToken.nome;
			cpfAssinante = dadosToken.cpf;
		}

		// Defesa adicional (A-5): o certificado precisa pertencer ao usuário
		// logado. Sem isto, qualquer admin com acesso físico/lógico a um token
		// de terceiro poderia produzir uma assinatura "em nome de" alguém,
		// preservando a aparência jurídica mas burlando a accountability.
		// O Admin Geral (`u.cpf == null` no schema) está dispensado — ele
		// assume o papel institucional de assinante de gestão.
		if (u.tipo !== 'admin' && dadosToken) {
			const cpfLogado = u.cpf || '';
			if (!cpfLogado) {
				return badRequest(
					'Seu cadastro não possui CPF — não é possível validar a propriedade do certificado. Contate o administrador.'
				);
			}
			if (dadosToken.cpf !== cpfLogado) {
				return badRequest('O token não pertence ao usuário logado (CPF incompatível).');
			}
			const nomeLogado = normalizarTexto(u.nome);
			const nomeToken = normalizarTexto(dadosToken.nome);
			if (nomeLogado && nomeToken && nomeToken !== nomeLogado) {
				return badRequest('O token não pertence ao usuário logado (Nome incompatível).');
			}
		}

		// Validação criptográfica + OCSP + extração de metadados (CAdES-LT).
		const verif = await verificarECarimbarAssinatura(signedPdf);
		if (!verif.ok) {
			// 4xx = falha do payload (assinatura inválida); 5xx = falha externa (OCSP).
			const code = verif.status >= 500 ? ErrorCode.UPSTREAM : ErrorCode.VALIDATION;
			return apiError(verif.error, verif.status, code);
		}
		// Preferimos os dados extraídos do certificado verificado.
		nomeAssinante = verif.signerName || nomeAssinante;
		cpfAssinante = verif.signerCpf || cpfAssinante;

		if (!hasR2(platform)) {
			return serverError('[finalizar-assinatura] R2 não configurado', new Error('R2_NOT_CONFIGURED'));
		}

		const bucket = getR2(platform);
		const r2Key = `escalas/${new Date().getFullYear()}/${id}_${verificationHash}.pdf`;
		// Sobe o PDF FINAL (com DSS, se PAdES-LT foi aplicado com sucesso).
		await bucket.put(r2Key, verif.pdfFinal, {
			httpMetadata: { contentType: 'application/pdf' }
		});

		await salvarDocumentoEscala(
			db,
			id,
			r2Key,
			nomeAssinante,
			cpfAssinante,
			verificationHash,
			ip ?? undefined,
			ua || undefined,
			latitude ?? undefined,
			longitude ?? undefined,
			undefined, // selfieKey
			documentHash ?? undefined,
			assinanteEmail ?? undefined,
			verif.tipoCarimboTempo,
			verif.metadata
		);

		await registrarAuditComContexto(db, {
			usuario: u,
			acao: 'assinar_escala',
			entidade: 'escala',
			entidade_id: id,
			detalhes: `Escala ${id} assinada por ${nomeAssinante} (${cpfAssinante})`
		});

		return json({ success: true, message: 'Escala assinada digitalmente com sucesso' });
	} catch (err) {
		return serverError(`[finalizar-assinatura] Falha (escala_id=${id})`, err);
	}
};
