/**
 * POST /api/gise/[id]/finalizar-assinatura
 *
 * Finaliza a assinatura digital do PDF da escala GISE.
 * Recebe o PDF preparado + assinatura (Web PKI ou SERPRO CMS) e embute no PDF.
 * Salva no R2, registra no banco e muda status para 'assinada'.
 */

import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { getDB, buscarGiseEscala, salvarGiseDocumento, atualizarGiseEscala } from '$lib/db';
import { finalizarAssinatura, embedSerproCms } from '$lib/server/pdf-signing';

export const POST = async ({ platform, params, request, locals }: RequestEvent) => {
	const u = locals.usuario;
	if (!u || u.tipo !== 'policial') {
		return json({ error: 'Não autorizado' }, { status: 401 });
	}

	const id = parseInt(params.id!);
	if (isNaN(id)) return json({ error: 'ID inválido' }, { status: 400 });

	const db = getDB(platform);
	const p = platform as App.Platform | undefined;
	const gise = await buscarGiseEscala(db, id);
	if (!gise) return json({ error: 'Escala GISE não encontrada' }, { status: 404 });

	const isSupervisor = gise.supervisor_sabado_id === u.id || gise.supervisor_domingo_id === u.id;
	if (!isSupervisor) {
		return json({ error: 'Apenas o Supervisor designado pode assinar esta escala' }, { status: 403 });
	}

	const body = await request.json();
	const { preparedPdf, rawSignature, certificateBase64, messageDigest, signingTimeISO, serproCms, signerName, signerCpf, verificationHash } = body;

	if (!preparedPdf) {
		return json({ error: 'preparedPdf é obrigatório' }, { status: 400 });
	}

	const filename = `gise_${gise.data_inicio}_assinada.pdf`;

	try {
		const preparedPdfBytes = new Uint8Array(Buffer.from(preparedPdf, 'base64'));
		let signedPdf: Uint8Array;

		if (serproCms) {
			signedPdf = await embedSerproCms(preparedPdfBytes, serproCms);
		} else {
			if (!rawSignature || !certificateBase64 || !messageDigest || !signingTimeISO) {
				return json(
					{ error: 'rawSignature, certificateBase64, messageDigest e signingTimeISO são obrigatórios para o fluxo Web PKI' },
					{ status: 400 }
				);
			}
			signedPdf = await finalizarAssinatura(
				preparedPdfBytes,
				rawSignature,
				certificateBase64,
				messageDigest,
				signingTimeISO
			);
		}

		// Salvar no R2 e registrar no banco
		const r2Key = `gise_${id}_assinada.pdf`;
		if (p?.env?.escalas_docs) {
			try {
				await p.env.escalas_docs.put(r2Key, signedPdf);
				await salvarGiseDocumento(db, id, r2Key, u.id, signerName || u.nome, signerCpf || '', verificationHash);
			} catch (err) {
				console.error('[gise/finalizar-assinatura] Erro ao salvar no R2 ou BD:', err);
			}
		} else {
			console.warn('[gise/finalizar-assinatura] R2 (escalas_docs) não configurado.');
		}

		// Atualizar status
		await atualizarGiseEscala(db, id, { status: 'assinada' });

		return new Response(signedPdf as unknown as BodyInit, {
			headers: {
				'Content-Type': 'application/pdf',
				'Content-Disposition': `attachment; filename="${filename}"`
			}
		});
	} catch (e) {
		const message = e instanceof Error ? e.message : 'Erro ao assinar PDF';
		console.error('[gise/finalizar-assinatura] Erro:', e);
		return json({ error: message }, { status: 500 });
	}
};
