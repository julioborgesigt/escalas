import { json } from '@sveltejs/kit';
import { getDB, listarPoliciais, criarPolicial, excluirPolicial } from '$lib/db';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ platform, url }) => {
	const db = getDB(platform);
	const lotacao = url.searchParams.get('lotacao') || undefined;
	const policiais = await listarPoliciais(db, lotacao);
	return json(policiais);
};

export const POST: RequestHandler = async ({ platform, request }) => {
	const db = getDB(platform);
	const data = await request.json();

	if (!data.nome || !data.matricula || !data.cargo || !data.lotacao) {
		return json({ error: 'Campos obrigatórios: nome, matricula, cargo, lotacao' }, { status: 400 });
	}

	if (!['DPC', 'OIP'].includes(data.cargo)) {
		return json({ error: 'Cargo deve ser DPC ou OIP' }, { status: 400 });
	}

	try {
		await criarPolicial(db, data);
		return json({ success: true }, { status: 201 });
	} catch (e: unknown) {
		const message = e instanceof Error ? e.message : 'Erro desconhecido';
		if (message.includes('UNIQUE')) {
			return json({ error: 'Matrícula já cadastrada' }, { status: 409 });
		}
		return json({ error: message }, { status: 500 });
	}
};

export const DELETE: RequestHandler = async ({ platform, url }) => {
	const db = getDB(platform);
	const id = url.searchParams.get('id');
	if (!id) return json({ error: 'ID obrigatório' }, { status: 400 });
	await excluirPolicial(db, Number(id));
	return json({ success: true });
};
