import { json } from '@sveltejs/kit';
import { getDB, buscarDocumentoPorHash } from '$lib/db';
import type { RequestEvent } from '@sveltejs/kit';

export const GET = async ({ platform, params }: RequestEvent) => {
	const db = getDB(platform);
	const hash = params.hash;

	if (!hash) {
		return json({ error: 'Código de verificação ausente' }, { status: 400 });
	}

	const documento = await buscarDocumentoPorHash(db, hash);
	if (!documento) {
		return json({ error: 'Documento não encontrado' }, { status: 404 });
	}

	if (!platform?.env?.escalas_docs) {
		return json({ error: 'Storage não configurado' }, { status: 500 });
	}

	const object = await platform.env.escalas_docs.get(documento.r2_key);
	if (!object) {
		return json({ error: 'Arquivo PDF não encontrado no Storage' }, { status: 404 });
	}

	const headers = new Headers();
	headers.set('Content-Type', 'application/pdf');
	headers.set('Content-Disposition', `attachment; filename="documento_assinado_${hash}.pdf"`);

	return new Response(object.body as unknown as BodyInit, { headers });
};
