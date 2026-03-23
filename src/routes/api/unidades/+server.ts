import { json } from '@sveltejs/kit';
import { getDB, listarUnidades, criarUnidade } from '$lib/db';
import { unidadeSchema } from '$lib/schemas';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ platform }) => {
	const db = getDB(platform);
	const unidades = await listarUnidades(db);
	return json(unidades);
};

export const POST: RequestHandler = async ({ platform, request, locals }) => {
	if (locals.usuario?.tipo !== 'admin') {
		return json({ error: 'Apenas administradores podem cadastrar unidades' }, { status: 403 });
	}

	const db = getDB(platform);
	const data = await request.json();

	const parsed = unidadeSchema.safeParse(data);
	if (!parsed.success) {
		return json({ error: parsed.error.issues[0].message }, { status: 400 });
	}

	try {
		await criarUnidade(db, parsed.data);
		return json({ success: true }, { status: 201 });
	} catch (e: unknown) {
		const message = e instanceof Error ? e.message : 'Erro desconhecido';
		if (message.includes('UNIQUE')) {
			return json({ error: 'Já existe uma unidade com este nome' }, { status: 409 });
		}
		return json({ error: message }, { status: 500 });
	}
};
