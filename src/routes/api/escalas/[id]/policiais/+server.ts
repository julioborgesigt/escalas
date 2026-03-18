import { json } from '@sveltejs/kit';
import { getDB, listarPoliciaisEscala, adicionarPolicialEscala, removerPolicialEscala } from '$lib/db';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ platform, params }) => {
	const db = getDB(platform);
	const policiais = await listarPoliciaisEscala(db, Number(params.id));
	return json(policiais);
};

export const POST: RequestHandler = async ({ platform, params, request }) => {
	const db = getDB(platform);
	const data = await request.json();

	if (!data.policial_id || !data.data_plantao) {
		return json({ error: 'policial_id e data_plantao são obrigatórios' }, { status: 400 });
	}

	await adicionarPolicialEscala(db, Number(params.id), data.policial_id, data.data_plantao);
	return json({ success: true }, { status: 201 });
};

export const DELETE: RequestHandler = async ({ platform, url }) => {
	const db = getDB(platform);
	const itemId = url.searchParams.get('item_id');
	if (!itemId) return json({ error: 'item_id obrigatório' }, { status: 400 });
	await removerPolicialEscala(db, Number(itemId));
	return json({ success: true });
};
