/**
 * POST /api/gise/[id]/finalizar-assinatura
 *
 * Finaliza a assinatura digital (PKCS#7) no PDF da GISE.
 * Salva o documento no R2 e registra no banco de dados.
 */

import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { getDB, buscarGiseEscala, salvarGiseDocumento } from '$lib/db';
import { finalizarAssinatura, embedSerproCms } from '$lib/server/pdf-signing';

export const POST = async ({ platform, params, locals, request, getClientAddress }: RequestEvent) => {
	const p = platform as App.Platform | undefined;
	const db = getDB(p);
	const u = locals.usuario;
	if (!u) return json({ error: 'Não autorizado' }, { status: 401 });

	const ip = getClientAddress();
	const ua = request.headers.get('user-agent') || '';

	const id = parseInt(params.id!);
	if (isNaN(id)) return json({ error: 'ID inválido' }, { status: 400 });

	const { preparedPdf, rawSignature, serproCms, certificateBase64, messageDigest, signingTimeISO, signerName, signerCpf, verificationHash, dia, latitude, longitude } = await request.json();

	try {
		const gise = await buscarGiseEscala(db, id);
		if (!gise) return json({ error: 'GISE não encontrada' }, { status: 404 });

		const diaFinal = dia || 'ambos';

		// Finalizar o PDF (assinado)
		let signedPdfBytes: Uint8Array;
		if (serproCms) {
			signedPdfBytes = await embedSerproCms(new Uint8Array(Object.values(preparedPdf)), serproCms);
		} else {
			signedPdfBytes = await finalizarAssinatura(
				new Uint8Array(Object.values(preparedPdf)),
				rawSignature,
				certificateBase64,
				messageDigest,
				signingTimeISO
			);
		}

		// Salvar no R2
		const documentKey = `gise_${id}_${diaFinal}_assinada.pdf`;
		const env = (p as any)?.env || (p as any);
		if (env?.escalas_docs) {
			await env.escalas_docs.put(documentKey, signedPdfBytes, {
				contentType: 'application/pdf'
			});
		}

		// Registrar no banco com auditoria
		await salvarGiseDocumento(db, id, documentKey, u.id, signerName || u.nome, signerCpf || '', verificationHash, diaFinal, undefined, ip, ua, latitude, longitude);

		return new Response(signedPdfBytes as any, {
			headers: {
				'Content-Type': 'application/pdf',
				'Content-Disposition': `attachment; filename="${documentKey}"`
			}
		});
	} catch (err: any) {
		console.error('[GISE SIGN]', err);
		return json({ error: err.message }, { status: 500 });
	}
};
