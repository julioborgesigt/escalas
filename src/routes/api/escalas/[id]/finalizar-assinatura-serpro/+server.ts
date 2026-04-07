import { json } from '@sveltejs/kit';
import { getDB, buscarEscala } from '$lib/db';
import { embedSerproCms } from '$lib/server/pdf-signing';
import type { RequestEvent } from '@sveltejs/kit';

/**
 * Recebe o PDF preparado com placeholder e o CMS retornado pelo Assinador SERPRO,
 * embute o CMS no placeholder e retorna o PDF assinado para download.
 */
export const POST = async ({ platform, params, request, locals }: RequestEvent) => {
	const db = getDB(platform);
	const escalaId = Number(params.id);
	if (isNaN(escalaId)) return json({ error: 'ID inválido' }, { status: 400 });
	const usuario = locals.usuario;

	if (!usuario) {
		return json({ error: 'Não autorizado' }, { status: 401 });
	}

	const escala = await buscarEscala(db, escalaId);
	if (!escala) {
		return json({ error: 'Escala não encontrada' }, { status: 404 });
	}

	const body = await request.json();
	const { preparedPdf, serproCms } = body as { preparedPdf?: string; serproCms?: string };

	if (!preparedPdf || !serproCms) {
		return json({ error: 'preparedPdf e serproCms são obrigatórios' }, { status: 400 });
	}

	try {
		const preparedPdfBytes = new Uint8Array(Buffer.from(preparedPdf, 'base64'));
		const signedPdf = await embedSerproCms(preparedPdfBytes, serproCms);

		const filename = `escala_${escala.cidade.toLowerCase().replace(/\s+/g, '_')}_${escala.data_inicio}_assinada.pdf`;

		return new Response(signedPdf as unknown as BodyInit, {
			headers: {
				'Content-Type': 'application/pdf',
				'Content-Disposition': `attachment; filename="${filename}"`
			}
		});
	} catch (e) {
		const message = e instanceof Error ? e.message : 'Erro ao finalizar assinatura SERPRO';
		return json({ error: message }, { status: 500 });
	}
};
