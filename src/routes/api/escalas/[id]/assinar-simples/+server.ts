/**
 * Assinatura EM TELA da escala (avançada, sem certificado) — o caminho usado
 * pela maioria: rubrica desenhada, mais foto, GPS e código por e-mail conforme
 * as flags de configuração.
 *
 * Produz e persiste os dois artefatos da escala assinada:
 *   - o PDF com o rodapé e o QR de `/validar`, gravado no R2;
 *   - a CÓPIA DE CONFERÊNCIA, em chave própria (`chaveConferencia`), que é a
 *     versão que circula.
 *
 * Reassinar substitui o documento anterior, e `limparR2ObsoletoEscala` remove
 * os blobs da assinatura antiga — mantendo os recém-gravados na lista de
 * exceções. Sem isso, cada reassinatura deixaria PDF e selfie órfãos no R2, com
 * dado pessoal e sem nenhuma linha que os localize (R2-1).
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	getDB,
	buscarEscala,
	buscarDocumentoEscala,
	listarPoliciaisEscala,
	salvarDocumentoEscala,
	registrarAuditComContexto,
	getR2,
	hasR2
} from '$lib/db';
import { limparR2ObsoletoEscala } from '$lib/server/r2-cleanup';
import { chaveConferencia } from '$lib/server/assinatura/copia-conferencia';
import { logger } from '$lib/server/logger';
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
import { validarEvidenciasAvancada } from '$lib/server/assinatura/signature-service';
import { uploadSelfieDataUri } from '$lib/server/assinatura/selfie-upload';
import { gerarPdf, gerarPdfPlantao, gerarPdfExpediente } from '$lib/server/export/export';
import {
	adicionarRodapeSimples,
	adicionarPaginaAuditoria
} from '$lib/server/assinatura/pdf-signing';
import { calcularHashBuffer } from '$lib/server/assinatura/document-utils';
import { selarPdfInstitucional, tipoCarimboPrevisto } from '$lib/server/assinatura/server-seal';
import { gerarCodigoValidacao } from '$lib/utils';
import { verificarPermissaoEscala } from '$lib/server/escalas/escala-permissao';

export const POST: RequestHandler = async ({
	platform,
	params,
	locals,
	url,
	request,
	getClientAddress
}) => {
	const u = requireAuth(locals);
	if (u instanceof Response) return u;

	const validated = await validateBody(request, assinarSimplesSchema);
	if (!validated.ok) return validated.response;
	const {
		rubrica,
		latitude,
		longitude,
		selfieBase64,
		codigoValidação,
		desafioId,
		livenessChallenge
	} = validated.data;

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
		if (escala.tipo === 'plantao')
			result = await Promise.resolve(gerarPdfPlantao(escala, policiais));
		else if (escala.tipo === 'expediente')
			result = await Promise.resolve(gerarPdfExpediente(escala, policiais));
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
			tipoCarimoTempo: tipoCarimboPrevisto(
				platform?.env as unknown as Record<string, string | undefined> | undefined
			),
			livenessChallenge: validatedEv.livenessChallenge
				? {
						tipo: validatedEv.livenessChallenge.tipo,
						cumprido: validatedEv.livenessChallenge.cumprido,
						tentativas: validatedEv.livenessChallenge.tentativas,
						duracaoMs: validatedEv.livenessChallenge.duracaoMs
					}
				: null
		});

		// Selo institucional (avançada, Lei 14.063/2020 art. 4º II): assina o PDF com
		// a chave da instituição + carimbo de tempo grátis. Sem a chave configurada
		// (SELO_INSTITUCIONAL_PEM), degrada para o rodapé honesto (finalPdf como está).
		const selado = await selarPdfInstitucional(finalPdf, finalSignerName, {
			env: platform?.env as unknown as Record<string, string | undefined> | undefined
		});
		const pdfParaSalvar = selado.ok ? selado.pdf : finalPdf;

		// arquivo_hash do PDF FINAL (selado ou não) — é o que a /validar reconfere.
		const arquivoHash = await calcularHashBuffer(pdfParaSalvar);

		if (!hasR2(platform)) {
			return serverError('[assinar-simples] R2 não configurado', new Error('R2_NOT_CONFIGURED'));
		}

		const bucket = getR2(platform);
		// R2-4: captura o documento anterior (re-assinatura) para apagar seus
		// objetos R2 obsoletos após a nova gravação (onConflict sobrescreve a linha).
		const docAntigo = await buscarDocumentoEscala(db, id);
		const r2Key = `escalas/${new Date().getFullYear()}/${id}_${verificationHash}.pdf`;
		await bucket.put(r2Key, pdfParaSalvar, {
			httpMetadata: { contentType: 'application/pdf' }
		});

		// Cópia de conferência: os MESMOS bytes do documento assinado ANTES da folha
		// de manifesto (`pdfComRodape` = escala + rodapé/QR + rubrica). Sem isto o
		// download "sem manifesto" caía na regeneração legada (PDF refeito na hora a
		// partir dos dados ATUAIS). O fluxo por token já gravava esta cópia.
		// Best-effort: falha não aborta a assinatura.
		try {
			await bucket.put(chaveConferencia(verificationHash), pdfComRodape, {
				httpMetadata: { contentType: 'application/pdf' }
			});
		} catch (err) {
			logger.warn('[escalas/assinar-simples] Falha ao gravar cópia de conferência', {
				escala_id: id,
				error: err instanceof Error ? err.message : String(err)
			});
		}

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
			arquivoHash,
			undefined, // assinanteEmail
			undefined, // tipoCarimboTempo
			undefined, // cadesMeta
			platform?.env
		);

		// R2-4: apaga os objetos R2 obsoletos do documento anterior (re-assinatura).
		// Novas chaves referenciadas: blob + conferência (hash atual) + selfie atual.
		await limparR2ObsoletoEscala(bucket, docAntigo, [
			r2Key,
			chaveConferencia(verificationHash),
			...(selfieKey ? [selfieKey] : [])
		]);

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
