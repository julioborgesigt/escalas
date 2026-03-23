import { json } from '@sveltejs/kit';
import { getDB, buscarEscala } from '$lib/db';
import { finalizarAssinatura, embedSerproCms } from '$lib/server/pdf-signing';
import type { RequestEvent } from '@sveltejs/kit';

export const POST = async ({ platform, params, request, locals }: RequestEvent) => {
	const db = getDB(platform);
	const escalaId = Number(params.id);
	const usuario = locals.usuario;

	if (!usuario) {
		return json({ error: 'Não autorizado' }, { status: 401 });
	}

	const escala = await buscarEscala(db, escalaId);
	if (!escala) {
		return json({ error: 'Escala não encontrada' }, { status: 404 });
	}

	const body = await request.json();
	const { preparedPdf, rawSignature, certificateBase64, messageDigest, signingTimeISO, serproCms } = body;

	if (!preparedPdf) {
		return json({ error: 'preparedPdf é obrigatório' }, { status: 400 });
	}

	const filename = `escala_${escala.cidade.toLowerCase().replace(/\s+/g, '_')}_${escala.data_inicio}_assinada.pdf`;

	try {
		const preparedPdfBytes = new Uint8Array(Buffer.from(preparedPdf, 'base64'));
		let signedPdf: Uint8Array;

		if (serproCms) {
			// Fluxo SERPRO: CMS PKCS#7 completo retornado pelo Assinador SERPRO.
			// O messageDigest já está correto (enviamos o hash do ByteRange ao SERPRO).
			// Basta embutir o CMS diretamente no placeholder do PDF.
			signedPdf = await embedSerproCms(preparedPdfBytes, serproCms);
		} else {
			// Fluxo Web PKI: assinatura RSA bruta + certificado separados.
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

		return new Response(signedPdf as unknown as BodyInit, {
			headers: {
				'Content-Type': 'application/pdf',
				'Content-Disposition': `attachment; filename="${filename}"`
			}
		});
	} catch (e) {
		const message = e instanceof Error ? e.message : 'Erro ao assinar PDF';
		console.error('[finalizar-assinatura] Erro:', e);
		return json({ error: message }, { status: 500 });
	}
};
