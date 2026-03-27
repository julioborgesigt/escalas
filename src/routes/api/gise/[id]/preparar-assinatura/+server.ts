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

export const POST = async ({ platform, params, request, locals, url }: RequestEvent) => {
	const u = locals.usuario;
	if (!u || u.tipo !== 'policial') {
		return json({ error: 'Não autorizado' }, { status: 401 });
	}

	const id = parseInt(params.id!);
	if (isNaN(id)) return json({ error: 'ID inválido' }, { status: 400 });

	const db = getDB(platform);
	const gise = await buscarGiseEscala(db, id);
	if (!gise) return json({ error: 'Escala GISE não encontrada' }, { status: 404 });

	if (gise.status !== 'aguardando_assinatura') {
		return json({ error: 'A escala não está pronta para assinatura' }, { status: 400 });
	}

	const isSupervisor = gise.supervisor_sabado_id === u.id || gise.supervisor_domingo_id === u.id;
	if (!isSupervisor) {
		return json({ error: 'Apenas o Supervisor designado pode assinar esta escala' }, { status: 403 });
	}

	const body = await request.json().catch(() => ({}));
	const signerName = (body as { signerName?: string }).signerName || u.nome;
	const signerCpf = (body as { signerCpf?: string }).signerCpf || '';

	const giseDetalhado = await buscarGiseDetalhado(db, id);
	if (!giseDetalhado) return json({ error: 'Erro ao carregar dados da escala' }, { status: 500 });

	const result = gerarPdfGise(giseDetalhado);
	const pdfBytes = result.pdf;
	const finalYmm = result.finalY;

	const verificationHash = gerarCodigoValidacao();
	const verificationUrl = `${url.origin}/validar/${verificationHash}`;

	const boxY = (210 - finalYmm) * 2.8346 + 1.5;

	const { preparedPdf, signedAttrsHashHex, messageDigest, signingTimeISO, dataToSignBase64 } =
		await prepararPdfParaAssinatura(pdfBytes, signerName, signerCpf, 'right', verificationHash, verificationUrl, boxY);

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
