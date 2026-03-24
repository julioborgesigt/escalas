import { json } from '@sveltejs/kit';
import { getDB, marcarVisto } from '$lib/db';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async ({ platform, params, request, locals }) => {
	const db = getDB(platform);
	const usuario = locals.usuario;

	if (usuario?.tipo !== 'admin') {
		return json({ error: 'Acesso negado' }, { status: 403 });
	}

	const id = Number(params.id);
	if (isNaN(id)) {
		return json({ error: 'ID inválido' }, { status: 400 });
	}

	try {
		const { visto } = await request.json();
		await marcarVisto(db, id, !!visto);
		return json({ success: true });
	} catch (err) {
		console.error('[PATCH /api/escalas/[id]/visto] erro:', err);
		return json({ error: 'Erro interno ao atualizar status' }, { status: 500 });
	}
};
