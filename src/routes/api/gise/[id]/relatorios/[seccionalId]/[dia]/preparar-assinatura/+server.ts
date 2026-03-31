/**
 * POST /api/gise/[id]/relatorios/[seccionalId]/[dia]/preparar-assinatura
 *
 * Prepara o PDF do Relatório Extraordinário (GISE) com placeholder de assinatura digital.
 */

import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { getDB, buscarGiseDetalhado, buscarPresencasGise } from '$lib/db';
import { gerarRelatorioExtraordinarioPdf } from '$lib/export';
import { prepararPdfParaAssinatura } from '$lib/server/pdf-signing';
import { gerarCodigoValidacao } from '$lib/utils';
import { isAdminGeral, isAdminSeccional } from '$lib/auth';

export const POST = async ({ platform, params, locals, url, request }: RequestEvent) => {
	const u = locals.usuario;
	if (!u || (u.tipo !== 'policial' && u.tipo !== 'admin')) {
		return json({ error: 'Não autorizado' }, { status: 401 });
	}

	const body = await request.json().catch(() => ({}));
	const { signerName, signerCpf, rubrica } = body;

	const id = parseInt(params.id!);
	const secIdNum = parseInt(params.seccionalId!);
	const dia = params.dia!;
	
	if (isNaN(id) || isNaN(secIdNum) || !['sabado', 'domingo'].includes(dia)) {
		return json({ error: 'Parâmetros inválidos' }, { status: 400 });
	}

	const db = getDB(platform);
	const gise = await buscarGiseDetalhado(db, id);
	if (!gise) return json({ error: 'Escala GISE não encontrada' }, { status: 404 });

	const presencas = await buscarPresencasGise(db, id, dia as any);

	// Gerar PDF temporário para extrair a altura da assinatura (sigY)
	const result = await gerarRelatorioExtraordinarioPdf(gise, dia as any, presencas, secIdNum, url.origin);
	const pdfBytes = result.pdf;
	const sigY = result.finalY; // mm do topo

	const verificationHash = gerarCodigoValidacao();
	const verificationUrl = `${url.origin}/validar/${verificationHash}`;

	// Relatório Extraordinário usa layout A4 Retrato (210mm x 297mm) com assinatura centralizada
	// sigCenterX = 210 / 2 = 105mm
	const rubW_pts = 130; 
	const rx_pts = (105 * 2.8346) - (rubW_pts / 2);
	const ry_pts = (297 - sigY + 2) * 2.8346; // 2mm acima da linha de assinatura

	const prepResult = await prepararPdfParaAssinatura(
		pdfBytes,
		signerName || u.nome,
		signerCpf || (u as any)?.cpf || '',
		'center',
		verificationHash,
		verificationUrl,
		undefined,
		rubrica || undefined,
		rx_pts,
		ry_pts
	);

	const { preparedPdf, signedAttrsHashHex, messageDigest, signingTimeISO, dataToSignBase64 } = prepResult;
	const preparedPdfBase64 = Buffer.from(preparedPdf).toString('base64');

	return json({
		signedAttrsHashHex,
		preparedPdf: preparedPdfBase64,
		messageDigest,
		signingTimeISO,
		dataToSignBase64,
		verificationHash
	});
};
