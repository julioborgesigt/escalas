/**
 * POST /api/gise/[id]/preparar-assinatura
 *
 * Prepara o PDF da escala GISE diária com placeholder de assinatura digital.
 * Retorna hash dos SignedAttributes para assinatura via Web PKI ou SERPRO.
 * Permissão: Supervisor designado (DPC).
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDB, buscarGiseEscala, buscarGiseDetalhado } from '$lib/db';
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
} from '$lib/server/export';
import { getBreveRelatorioEnvMergido } from '$lib/server/breve-relatorio-env';
import {
	prepararPdfParaAssinatura,
	adicionarPaginaAuditoria,
	adicionarRodapeUniversal
} from '$lib/server/pdf-signing';
import { calcularHashBuffer } from '$lib/server/document-utils';
import { PDFDocument } from 'pdf-lib';
import { gerarCodigoValidacao } from '$lib/utils';
import { getR2 } from '$lib/server/platform';

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
	const { signerName, signerCpf, rubrica, latitude, longitude } = validated.data;
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

	const r2Logo = getR2(platform);
	let logoJpgBytes: Uint8Array | undefined;
	if (r2Logo) {
		try {
			const logoObj = await r2Logo.get('assets/logogise.jpg');
			if (logoObj) logoJpgBytes = new Uint8Array(await logoObj.arrayBuffer());
		} catch {
			/* logo optional */
		}
	}
	const gisePdf = giseDetalhadoComMatriculaSupervisorSessao(giseDetalhado, u);
	const brEnv = await getBreveRelatorioEnvMergido(db);
	const result = await gerarPdfGise(toGisePdfData(gisePdf, brEnv), logoJpgBytes);
	const pdfBytes = result.pdf;
	const sigY = result.finalY;

	// 1. Calcular hash SHA-256 do PDF original (antes de qualquer modificação visual)
	const documentHash = await calcularHashBuffer(pdfBytes);

	const verificationHash = gerarCodigoValidacao();
	const verificationUrl = `${url.origin}/validar/${verificationHash}`;

	const finalSignerName = signerName && signerName.trim() ? signerName : u.nome;
	const finalSignerCpf = signerCpf && signerCpf.trim() ? signerCpf : '';
	const assinanteEmail = u.email ?? undefined;

	// 2. Adicionar rodapé universal nas páginas de conteúdo
	const origDoc = await PDFDocument.load(pdfBytes);
	const contentPageCount = origDoc.getPageCount();

	const pdfComRodape = await adicionarRodapeUniversal(pdfBytes, {
		documentHash,
		verificationUrl,
		verificationHash,
		contentPageCount
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
		tipoCarimoTempo: (platform?.env as unknown as Record<string, string | undefined> | undefined)?.TSA_URL ? 'tsa_externa' : 'servidor'
	});

	// contentPageIndex = índice da última página de conteúdo (para posicionar o carimbo PKI)
	const contentPageIndex = contentPageCount - 1;
	const boxY_pts = (210 - sigY) * 2.8346 + 1.5;

	const prepResult = await prepararPdfParaAssinatura(
		pdfWithAudit,
		finalSignerName,
		finalSignerCpf,
		'right',
		verificationHash,
		verificationUrl,
		boxY_pts,
		rubrica || undefined,
		undefined,
		undefined,
		contentPageIndex
	);

	const { preparedPdf, signedAttrsHashHex, messageDigest, signingTimeISO, dataToSignBase64 } =
		prepResult;
	const preparedPdfBase64 = Buffer.from(preparedPdf).toString('base64');

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
