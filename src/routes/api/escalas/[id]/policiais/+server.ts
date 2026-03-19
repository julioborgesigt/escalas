import { json } from '@sveltejs/kit';
import { getDB, buscarEscala, listarPoliciaisEscala, adicionarPolicialEscala, removerPolicialEscala, atualizarEscalaPolicial } from '$lib/db';
import type { RequestHandler } from './$types';

async function verificarAcessoEscala(db: D1Database, escalaId: number, locals: App.Locals): Promise<Response | null> {
	if (locals.usuario?.tipo === 'policial') {
		const escala = await buscarEscala(db, escalaId);
		if (escala && escala.lotacao !== locals.usuario.lotacao) {
			return json({ error: 'Sem permissão' }, { status: 403 }) as Response;
		}
	}
	return null;
}

export const GET: RequestHandler = async ({ platform, params, locals }) => {
	const db = getDB(platform);
	const escalaId = Number(params.id);

	const bloqueio = await verificarAcessoEscala(db, escalaId, locals);
	if (bloqueio) return bloqueio;

	const policiais = await listarPoliciaisEscala(db, escalaId);
	return json(policiais);
};

export const POST: RequestHandler = async ({ platform, params, request, locals }) => {
	const db = getDB(platform);
	const escalaId = Number(params.id);

	const bloqueio = await verificarAcessoEscala(db, escalaId, locals);
	if (bloqueio) return bloqueio;

	const data = await request.json();

	if (!data.policial_id || !data.data_plantao) {
		return json({ error: 'policial_id e data_plantao são obrigatórios' }, { status: 400 });
	}

	await adicionarPolicialEscala(
		db,
		escalaId,
		data.policial_id,
		data.data_plantao,
		data.data_saida || data.data_plantao,
		data.hora_entrada || '',
		data.hora_saida || ''
	);
	return json({ success: true }, { status: 201 });
};

export const PATCH: RequestHandler = async ({ platform, params, request, locals }) => {
	const db = getDB(platform);
	const escalaId = Number(params.id);

	const bloqueio = await verificarAcessoEscala(db, escalaId, locals);
	if (bloqueio) return bloqueio;

	const data = await request.json();

	if (!data.item_id) {
		return json({ error: 'item_id é obrigatório' }, { status: 400 });
	}

	await atualizarEscalaPolicial(
		db,
		data.item_id,
		data.data_plantao || '',
		data.data_saida || '',
		data.hora_entrada || '',
		data.hora_saida || ''
	);
	return json({ success: true });
};

export const DELETE: RequestHandler = async ({ platform, params, url, locals }) => {
	const db = getDB(platform);
	const escalaId = Number(params.id);

	const bloqueio = await verificarAcessoEscala(db, escalaId, locals);
	if (bloqueio) return bloqueio;

	const itemId = url.searchParams.get('item_id');
	if (!itemId) return json({ error: 'item_id obrigatório' }, { status: 400 });
	await removerPolicialEscala(db, Number(itemId));
	return json({ success: true });
};
