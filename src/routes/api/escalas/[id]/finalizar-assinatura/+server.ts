import { json } from '@sveltejs/kit';
import { getDB, buscarEscala } from '$lib/db';
import { finalizarAssinatura } from '$lib/server/pdf-signing';
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

	const { preparedPdf, rawSignature, certificateBase64, messageDigest, signingTimeISO } =
		await request.json();

	if (!preparedPdf || !rawSignature || !certificateBase64 || !messageDigest || !signingTimeISO) {
		return json(
			{ error: 'preparedPdf, rawSignature, certificateBase64, messageDigest e signingTimeISO são obrigatórios' },
			{ status: 400 }
		);
	}

	try {
		const preparedPdfBytes = new Uint8Array(Buffer.from(preparedPdf, 'base64'));
		const signedPdf = await finalizarAssinatura(
			preparedPdfBytes,
			rawSignature,
			certificateBase64,
			messageDigest,
			signingTimeISO
		);

		const filename = `escala_${escala.cidade.toLowerCase().replace(/\s+/g, '_')}_${escala.data_inicio}_assinada.pdf`;

		return new Response(signedPdf as unknown as BodyInit, {
			headers: {
				'Content-Type': 'application/pdf',
				'Content-Disposition': `attachment; filename="${filename}"`
			}
		});
	} catch (e) {
		const message = e instanceof Error ? e.message : 'Erro ao assinar PDF';
		return json({ error: message }, { status: 500 });
	}
};
