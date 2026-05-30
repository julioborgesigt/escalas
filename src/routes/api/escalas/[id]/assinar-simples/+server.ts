import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDB, buscarEscala, listarPoliciaisEscala, salvarDocumentoEscala, registrarAuditComContexto, getR2, hasR2 } from '$lib/db';
import { assinarSimplesSchema } from '$lib/schemas';
import {
	requireAuth,
	apiError,
	ErrorCode,
	badRequest,
	notFound,
	forbidden,
	serverError,
	validateBody
} from '$lib/server/api';
import { validarEvidenciasAvancada } from '$lib/server/signature-service';
import { uploadSelfieDataUri } from '$lib/server/selfie-upload';
import { gerarPdf, gerarPdfPlantao, gerarPdfExpediente } from '$lib/server/export';
import { adicionarRodapeSimples, adicionarPaginaAuditoria } from '$lib/server/pdf-signing';
import { calcularHashBuffer } from '$lib/server/document-utils';
import { gerarCodigoValidacao } from '$lib/utils';
import { verificarPermissaoEscala } from '$lib/server/escala-permissao';

export const POST: RequestHandler = async ({ platform, params, locals, url, request, getClientAddress }) => {
	const u = requireAuth(locals);
	if (u instanceof Response) return u;

	const validated = await validateBody(request, assinarSimplesSchema);
	if (!validated.ok) return validated.response;
	const { rubrica, latitude, longitude, selfieBase64, codigoValidação, desafioId, livenessChallenge } = validated.data;

	const ip = getClientAddress();
	const ua = request.headers.get('user-agent') || '';

	const id = parseInt(params.id!);
	if (isNaN(id)) return badRequest('ID inválido');

	const db = getDB(platform);
	const escala = await buscarEscala(db, id);
	if (!escala) return notFound('Escala');

	// Permissão de negócio: admin, dono da lotação ou DPC admin com solicitação direcionada.
	const perm = await verificarPermissaoEscala(db, id, escala.lotacao, u);
	if (!perm.permitido) return forbidden(perm.motivo ?? 'Sem permissão para assinar esta escala');

	const policiais = await listarPoliciaisEscala(db, id);
	if (!policiais || policiais.length === 0) {
		return badRequest('A escala está vazia e não pode ser assinada');
	}

	// Validação de evidências unificada: aplica TODAS as flags globais
	// (foto/GPS/2FA) — antes da consolidação, este endpoint ignorava silenciosamente
	// foto e 2FA, fazendo escala mensal cair para nível SIMPLES (Lei 14.063 art. 4º I)
	// mesmo com flags ligadas no admin.
	const evid = await validarEvidenciasAvancada(
		db,
		u,
		{ rubrica, latitude, longitude, selfieBase64, codigoValidação, desafioId, livenessChallenge },
		{ platform }
	);
	if (!evid.ok) return apiError(evid.error, evid.status, ErrorCode.VALIDATION);
	const validatedEv = evid.validated;

	try {
		let result;
		if (escala.tipo === 'plantao') result = await Promise.resolve(gerarPdfPlantao(escala, policiais));
		else if (escala.tipo === 'expediente') result = await Promise.resolve(gerarPdfExpediente(escala, policiais));
		else result = await Promise.resolve(gerarPdf(escala, policiais));

		const pdfBytes = result.pdf;

		const verificationHash = gerarCodigoValidacao();
		const verificationUrl = `${url.origin}/validar/${verificationHash}`;

		const finalSignerName = u.nome;
		const finalSignerCpf = u.cpf || '';

		// Assinatura AVANÇADA (Lei 14.063/2020 art. 4º II): rodapé de confirmação
		// eletrônica + manifesto. NÃO embute placeholder PKCS#7 nem selo "ICP-Brasil"
		// — não há certificado nesta modalidade. Mesma abordagem honesta do fluxo GISE;
		// rotular como qualificada/ICP aqui seria enganoso e frágil em perícia.
		const pdfComRodape = await adicionarRodapeSimples(pdfBytes, finalSignerName, {
			verificationHash,
			verificationUrl,
			rubricBase64: validatedEv.rubrica ?? undefined,
			ip: ip ?? undefined,
			latitude: validatedEv.latitude,
			longitude: validatedEv.longitude
		});

		// Hash do documento (conteúdo + rodapé) exibido no manifesto.
		const documentHash = await calcularHashBuffer(pdfComRodape);

		// Folha de auditoria com nível AVANÇADA (Lei 14.063/2020 art. 4º II).
		const finalPdf = await adicionarPaginaAuditoria(pdfComRodape, {
			signerName: finalSignerName,
			signerCpf: finalSignerCpf || undefined,
			signerEmail: u.email ?? undefined,
			signingTime: new Date(),
			verificationHash,
			verificationUrl,
			ip: ip ?? undefined,
			userAgent: ua || undefined,
			latitude: validatedEv.latitude ?? undefined,
			longitude: validatedEv.longitude ?? undefined,
			selfieBase64: validatedEv.selfieBase64 ?? undefined,
			rubricBase64: validatedEv.rubrica ?? undefined,
			documentHash,
			token: crypto.randomUUID(),
			documentName: `Escala de Serviço - ${escala.titulo}`,
			signatureLevel: 'avancada',
			livenessChallenge: validatedEv.livenessChallenge
				? {
						tipo: validatedEv.livenessChallenge.tipo,
						cumprido: validatedEv.livenessChallenge.cumprido,
						tentativas: validatedEv.livenessChallenge.tentativas,
						duracaoMs: validatedEv.livenessChallenge.duracaoMs
					}
				: null
		});

		// arquivo_hash do PDF FINAL — é o que a página /validar reconfere (integridade custodial).
		const arquivoHash = await calcularHashBuffer(finalPdf);

		if (!hasR2(platform)) {
			return serverError('[assinar-simples] R2 não configurado', new Error('R2_NOT_CONFIGURED'));
		}

		const bucket = getR2(platform);
		const r2Key = `escalas/${new Date().getFullYear()}/${id}_${verificationHash}.pdf`;
		await bucket.put(r2Key, finalPdf, {
			httpMetadata: { contentType: 'application/pdf' }
		});

		// Upload de selfie quando enviada (helper valida magic bytes + tamanho).
		let selfieKey: string | undefined;
		if (validatedEv.selfieBase64) {
			const year = new Date().getFullYear();
			const r = await uploadSelfieDataUri(
				bucket,
				`escalas/${year}/${id}/selfies`,
				validatedEv.selfieBase64
			);
			if (r.ok) selfieKey = r.key;
		}

		await salvarDocumentoEscala(
			db,
			id,
			r2Key,
			finalSignerName,
			finalSignerCpf || undefined,
			verificationHash,
			ip ?? undefined,
			ua || undefined,
			validatedEv.latitude ?? undefined,
			validatedEv.longitude ?? undefined,
			selfieKey,
			arquivoHash
		);

		await registrarAuditComContexto(db, {
			usuario: u,
			acao: 'assinar_escala',
			entidade: 'escala',
			entidade_id: id,
			detalhes: `Escala ${id} assinada via rubrica (avançada) por ${finalSignerName}`
		});

		return json({ success: true, message: 'Escala assinada manualmente com sucesso' });
	} catch (err) {
		return serverError(`[assinar-simples] Falha ao processar assinatura (escala_id=${id})`, err);
	}
};
