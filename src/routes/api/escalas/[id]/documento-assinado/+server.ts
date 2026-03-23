import { json } from '@sveltejs/kit';
import { getDB, buscarDocumentoEscala } from '$lib/db';
import type { RequestEvent } from '@sveltejs/kit';

export const GET = async ({ platform, params, locals }: RequestEvent) => {
	const db = getDB(platform);
	const escalaId = Number(params.id);
	const usuario = locals.usuario;

	if (!usuario) {
		return json({ error: 'Não autorizado' }, { status: 401 });
	}

	const documento = await buscarDocumentoEscala(db, escalaId);
	if (!documento) {
		return json({ error: 'Documento assinado não encontrado para esta escala' }, { status: 404 });
	}

	if (!platform?.env?.escalas_docs) {
		return json({ error: 'Storage R2 não configurado no servidor' }, { status: 500 });
	}

	const object = await platform.env.escalas_docs.get(documento.r2_key);
	if (!object) {
		return json({ error: 'Arquivo PDF não encontrado no Storage' }, { status: 404 });
	}

	const headers = new Headers();
	headers.set('Content-Type', 'application/pdf');
	headers.set('Content-Disposition', `attachment; filename="${documento.r2_key}"`);

	return new Response(object.body as unknown as BodyInit, {
		headers
	});
};
