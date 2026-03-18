import { json } from '@sveltejs/kit';
import { getDB, buscarPolicial, atualizarPolicial, excluirPolicial } from '$lib/db';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ platform, params }) => {
	const db = getDB(platform);
	const policial = await buscarPolicial(db, Number(params.id));
	if (!policial) return json({ error: 'Policial não encontrado' }, { status: 404 });
	return json(policial);
};

export const PUT: RequestHandler = async ({ platform, params, request }) => {
	const db = getDB(platform);
	const data = await request.json();
	try {
		await atualizarPolicial(db, Number(params.id), data);
		return json({ success: true });
	} catch (e: unknown) {
		const message = e instanceof Error ? e.message : 'Erro desconhecido';
		if (message.includes('UNIQUE')) {
			return json({ error: 'Matrícula já cadastrada' }, { status: 409 });
		}
		return json({ error: message }, { status: 500 });
	}
};

export const DELETE: RequestHandler = async ({ platform, params }) => {
	const db = getDB(platform);
	await excluirPolicial(db, Number(params.id));
	return json({ success: true });
};
