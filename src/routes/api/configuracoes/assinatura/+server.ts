import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDB, buscarExigirFotoAssinatura, salvarConfiguracao } from '$lib/db';

export const GET: RequestHandler = async ({ platform }) => {
	const db = getDB(platform);
	const exigirFoto = await buscarExigirFotoAssinatura(db);
	return json({ exigirFoto });
};

export const PUT: RequestHandler = async ({ platform, request, locals }) => {
	if (locals.usuario?.tipo !== 'admin') {
		return json({ error: 'Acesso negado' }, { status: 403 });
	}

	const body = await request.json().catch(() => ({}));
	if (typeof body.exigirFoto !== 'boolean') {
		return json({ error: 'Campo exigirFoto obrigatório (boolean)' }, { status: 400 });
	}

	const db = getDB(platform);
	await salvarConfiguracao(db, 'exigir_foto_assinatura', body.exigirFoto ? '1' : '0');
	return json({ ok: true });
};
