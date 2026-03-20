import { json } from '@sveltejs/kit';
import { getDB, excluirUnidade } from '$lib/db';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = async ({ platform, params, locals }) => {
	if (locals.usuario?.tipo !== 'admin') {
		return json({ error: 'Apenas administradores podem excluir unidades' }, { status: 403 });
	}

	const db = getDB(platform);
	const id = Number(params.id);

	if (!id) {
		return json({ error: 'ID inválido' }, { status: 400 });
	}

	await excluirUnidade(db, id);
	return json({ success: true });
};
