/**
 * POST /api/gise/[id]/preparar-assinatura
 *
 * Prepara o PDF da escala GISE diária com placeholder de assinatura digital.
 * Retorna hash dos SignedAttributes para assinatura via Web PKI ou SERPRO.
 * Permissão: Supervisor designado (DPC).
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { carregarLogosGise } from '$lib/server/gise/gise-logos';
import { getDB, buscarGiseEscala, buscarGiseDetalhado, buscarPolicial } from '$lib/db';
import { prepararAssinaturaSchema } from '$lib/schemas';
import {
	requireAuth,
	badRequest,
	notFound,
	forbidden,
	serverError,
	validateBody
} from '$lib/server/api';
import {
	gerarPdfGise,
	toGisePdfData,
	giseDetalhadoComMatriculaSupervisorSessao
} from '$lib/server/export/export';
import { getBreveRelatorioEnvMergido } from '$lib/server/gise/breve-relatorio-env';
import {
	prepararPdfParaAssinatura,
	adicionarPaginaAuditoria,
	adicionarRodapeUniversal,
	estamparRubricaLimpa
} from '$lib/server/assinatura/pdf-signing';
import { chaveConferencia } from '$lib/server/assinatura/copia-conferencia';
import { calcularHashBuffer } from '$lib/server/assinatura/document-utils';
import { logger } from '$lib/server/logger';
import { PDFDocument } from 'pdf-lib';
import { gerarCodigoValidacao } from '$lib/utils';
import { tryGetR2 } from '$lib/db';

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
	if (u.tipo !== 'policial')
		return forbidden('Apenas policiais designados como supervisor podem assinar');

	const validated = await validateBody(request, prepararAssinaturaSchema);
	if (!validated.ok) return validated.response;
	// `rubrica` do body é ignorada: vem do cadastro do perfil (server-side).
	const { signerName, signerCpf, latitude, longitude } = validated.data;
	const ip = getClientAddress();
	const ua = request.headers.get('user-agent') || '';

	const id = parseInt(params.id!);
	if (isNaN(id)) return badRequest('ID inválido');

	const db = getDB(platform);
	const gise = await buscarGiseEscala(db, id);
	if (!gise) return notFound('Escala GISE');

	if (gise.status !== 'aguardando_assinatura' && gise.status !== 'em_andamento') {
		return badRequest('A escala não está pronta para assinatura');
	}

	if (gise.supervisor_id !== u.id) {
		return forbidden('Apenas o Supervisor designado pode assinar esta escala');
	}

	const giseDetalhado = await buscarGiseDetalhado(db, id);
	if (!giseDetalhado) {
		return serverError(
			'[gise/preparar-assinatura] buscarGiseDetalhado retornou null',
			new Error('GISE_DETALHADO_NULL')
		);
	}

	// `r2Logo` continua necessário adiante (grava a cópia de conferência no R2).
	const r2Logo = tryGetR2(platform);
	const { esq: logoJpgBytes, dir: logoCearaBytes } = await carregarLogosGise(platform);
	const gisePdf = giseDetalhadoComMatriculaSupervisorSessao(giseDetalhado, u);
	const brEnv = await getBreveRelatorioEnvMergido(db);
	const result = await gerarPdfGise(toGisePdfData(gisePdf, brEnv), logoJpgBytes, logoCearaBytes);
	const pdfBytes = result.pdf;
	const sigY = result.finalY;

	// 1. Calcular hash SHA-256 do PDF original (antes de qualquer modificação visual)
	const documentHash = await calcularHashBuffer(pdfBytes);

	const verificationHash = gerarCodigoValidacao();
	const verificationUrl = `${url.origin}/validar/${verificationHash}`;

	const finalSignerName = signerName && signerName.trim() ? signerName : u.nome;
	const finalSignerCpf = signerCpf && signerCpf.trim() ? signerCpf : '';
	const assinanteEmail = u.email ?? undefined;

	// Rubrica + matrícula do supervisor (signatário). Rubrica vai no campo de
	// assinatura (estilo 'rubrica'); matrícula, no rodapé de identidade. `rubrica`
	// do body é ignorada — a fonte é o cadastro do perfil.
	const polAss = await buscarPolicial(db, u.id);
	const rubricaAssinatura = polAss?.rubrica ?? undefined;
	const matriculaAssinatura = u.matricula ?? polAss?.matricula ?? undefined;

	// 2. Adicionar rodapé universal nas páginas de conteúdo (+ bloco de identidade
	//    com QR na página do campo de assinatura).
	const origDoc = await PDFDocument.load(pdfBytes);
	const contentPageCount = origDoc.getPageCount();

	const pdfComRodape = await adicionarRodapeUniversal(pdfBytes, {
		documentHash,
		verificationUrl,
		verificationHash,
		contentPageCount,
		signerName: finalSignerName,
		signerMatricula: matriculaAssinatura,
		signedAtISO: new Date().toISOString()
	});

	// 3. Adicionar folha de auditoria ANTES de assinar (preserva validade criptográfica)
	const pdfWithAudit = await adicionarPaginaAuditoria(pdfComRodape, {
		signerName: finalSignerName,
		signerCpf: finalSignerCpf || undefined,
		signerEmail: assinanteEmail,
		signingTime: new Date(),
		verificationHash,
		verificationUrl,
		ip: ip ?? undefined,
		userAgent: ua || undefined,
		latitude: latitude ?? undefined,
		longitude: longitude ?? undefined,
		token: crypto.randomUUID(),
		documentName: `Escala de Serviço GISE - ${gise.data_inicio}`,
		signatureLevel: 'qualificada',
		documentHash,
		tipoCarimoTempo: (platform?.env as unknown as Record<string, string | undefined> | undefined)
			?.TSA_URL
			? 'tsa_externa'
			: 'servidor'
	});

	// contentPageIndex = índice da última página de conteúdo (para posicionar o carimbo PKI)
	const contentPageIndex = contentPageCount - 1;
	// Campo da rubrica logo acima da linha; piso baixo (campo à direita, rodapé à esquerda).
	const boxY_pts = Math.max((210 - sigY) * 2.8346 + 3, 40);

	const prepResult = await prepararPdfParaAssinatura(
		pdfWithAudit,
		finalSignerName,
		'right',
		verificationHash,
		verificationUrl,
		boxY_pts,
		rubricaAssinatura,
		undefined,
		undefined,
		contentPageIndex,
		'rubrica'
	);

	const { preparedPdf, signedAttrsHashHex, messageDigest, signingTimeISO, dataToSignBase64 } =
		prepResult;
	const preparedPdfBase64 = Buffer.from(preparedPdf).toString('base64');

	// Cópia de conferência IDÊNTICA (mesmos bytes: pdfComRodape + estamparRubricaLimpa,
	// sem manifesto/placeholder), gravada no R2 sob a chave plana `conferencia/<hash>.pdf`.
	// Best-effort: falha aqui nunca aborta a assinatura.
	if (r2Logo) {
		try {
			const conferenciaPdf = await estamparRubricaLimpa(pdfComRodape, {
				alignment: 'right',
				customBoxY: boxY_pts,
				rubricBase64: rubricaAssinatura,
				targetPageIndex: contentPageIndex
			});
			await r2Logo.put(chaveConferencia(verificationHash), conferenciaPdf, {
				httpMetadata: { contentType: 'application/pdf' }
			});
		} catch (err) {
			logger.warn('[gise/preparar-assinatura] Falha ao gerar/gravar cópia de conferência', {
				gise_id: id,
				error: err instanceof Error ? err.message : String(err)
			});
		}
	}

	return json({
		signedAttrsHashHex,
		preparedPdf: preparedPdfBase64,
		messageDigest,
		signingTimeISO,
		dataToSignBase64,
		verificationHash,
		documentHash,
		assinanteEmail
	});
};
