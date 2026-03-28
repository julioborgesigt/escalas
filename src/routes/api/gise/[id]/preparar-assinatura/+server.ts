/**
 * POST /api/gise/[id]/preparar-assinatura
 *
 * Prepara o PDF da escala GISE com placeholder de assinatura digital.
 * Retorna hash dos SignedAttributes para assinatura via Web PKI ou SERPRO.
 * Permissão: Supervisor designado (DPC).
 */

import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { getDB, buscarGiseEscala, buscarGiseDetalhado } from '$lib/db';
import { gerarPdfGise } from '$lib/export';
import { prepararPdfParaAssinatura } from '$lib/server/pdf-signing';
import { gerarCodigoValidacao } from '$lib/utils';

export const POST = async ({ platform, params, locals, url, request }: RequestEvent) => {
	const u = locals.usuario;
	if (!u || u.tipo !== 'policial') {
		return json({ error: 'Não autorizado' }, { status: 401 });
	}

	const { signerName, signerCpf, dia, rubrica } = await request.json();

	const id = parseInt(params.id!);
	if (isNaN(id)) return json({ error: 'ID inválido' }, { status: 400 });

	const db = getDB(platform);
	const gise = await buscarGiseEscala(db, id);
	if (!gise) return json({ error: 'Escala GISE não encontrada' }, { status: 404 });

	if (gise.status !== 'aguardando_assinatura' && gise.status !== 'assinada') {
		return json({ error: 'A escala não está pronta para assinatura' }, { status: 400 });
	}

	const isSupervisor = gise.supervisor_sabado_id === u.id || gise.supervisor_domingo_id === u.id;
	if (!isSupervisor) {
		return json({ error: 'Apenas o Supervisor designado pode assinar esta escala' }, { status: 403 });
	}

	const giseDetalhado = await buscarGiseDetalhado(db, id);
	if (!giseDetalhado) return json({ error: 'Erro ao carregar dados da escala' }, { status: 500 });

	const result = gerarPdfGise(giseDetalhado, dia === 'ambos' ? undefined : dia as 'sabado' | 'domingo');
	const pdfBytes = result.pdf;
	const sigY = result.finalY; // mm from top

	const verificationHash = gerarCodigoValidacao();
	const verificationUrl = `${url.origin}/validar/${verificationHash}`;

	// Calcular posição da rubrica (pdf-lib usa pontos do bottom: 1mm = 2.8346 pts)
	// giseSigCenterX = 0.75 * 297mm = 222.75mm
	const rubW_pts = 130; 
	const rx_pts = (222.75 * 2.8346) - (rubW_pts / 2);
	const ry_pts = (210 - sigY + 2) * 2.8346; // 2mm acima da linha

	const prepResult = await prepararPdfParaAssinatura(
		pdfBytes,
		signerName || u.nome, // Use u.nome as fallback for signerName
		signerCpf || '', // Use empty string as fallback for signerCpf
		'right',
		verificationHash,
		verificationUrl,
		undefined, // boxY is now undefined
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
