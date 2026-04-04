/**
 * POST /api/gise/[id]/relatorios/[seccionalId]/preparar-assinatura
 *
 * Prepara o PDF do Relatório Extraordinário (GISE) com placeholder de assinatura digital.
 */

import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { getDB, buscarGiseDetalhado, buscarPresencasGise } from '$lib/db';
import { gerarRelatorioExtraordinarioPdf } from '$lib/export';
import { prepararPdfParaAssinatura } from '$lib/server/pdf-signing';
import { gerarCodigoValidacao } from '$lib/utils';

export const POST = async ({ platform, params, locals, url, request }: RequestEvent) => {
	const u = locals.usuario;
	if (!u || (u.tipo !== 'policial' && u.tipo !== 'admin')) {
		return json({ error: 'Não autorizado' }, { status: 401 });
	}

	const body = await request.json().catch(() => ({}));
	const { signerName, signerCpf, rubrica } = body;

	const id = parseInt(params.id!);
	const secIdNum = parseInt(params.seccionalId!);

	if (isNaN(id) || isNaN(secIdNum)) {
		return json({ error: 'Parâmetros inválidos' }, { status: 400 });
	}

	const db = getDB(platform);
	const gise = await buscarGiseDetalhado(db, id);
	if (!gise) return json({ error: 'Escala GISE não encontrada' }, { status: 404 });

	const presencas = await buscarPresencasGise(db, id);

	const finalSignerName = signerName && signerName.trim() ? signerName : u.nome;
	const finalSignerCpf = signerCpf && signerCpf.trim() ? signerCpf : u.cpf || '';

	const mockSignature = {
		assinante_nome: finalSignerName,
		assinante_matricula: (u as any)?.matricula || '—'
	};

	const result = await gerarRelatorioExtraordinarioPdf(gise, presencas, secIdNum, url.origin, mockSignature, undefined, true);
	const pdfBytes = result.pdf;
	const sigY = result.finalY;

	const verificationHash = gerarCodigoValidacao();
	const verificationUrl = `${url.origin}/validar/${verificationHash}`;

	// Conversão de mm (jsPDF) para pts (pdf-lib)
	const mmToPts = 2.8346;
	const pageHeight_mm = 210; // A4 landscape height is 210mm? NO, it's orientation: landscape, so height is 210, width 297.
	// Wait, jsPDF {orientation: 'landscape', format: 'a4'} means 297mm width, 210mm height.
	// Let's check export.ts: doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
	// Page height for A4 landscape is 210mm.

	const rubW_pts = 130;
	const rx_pts = (297 / 2 - (rubW_pts / mmToPts) / 2) * mmToPts; // Centralizado
	
	// A linha de assinatura está em sigY (mm do topo). 
	// Em pdf-lib (pts da base): 
	const sigY_pts = (210 - sigY) * mmToPts;
	
	// Queremos a rubrica logo acima da linha
	const ry_pts = sigY_pts + (2 * mmToPts); 
	
	// O carimbo (box azul) deve ficar acima da linha também.
	// O box tem 70pts de altura. Vamos colocar sua base 5mm acima da linha.
	const boxY_pts = sigY_pts + (5 * mmToPts);

	const prepResult = await prepararPdfParaAssinatura(
		pdfBytes,
		finalSignerName,
		finalSignerCpf,
		'center',
		verificationHash,
		verificationUrl,
		boxY_pts,
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
