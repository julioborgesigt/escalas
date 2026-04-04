import { json } from '@sveltejs/kit';
import { getDB, buscarPolicial, atualizarPolicial, excluirPolicial, type Database } from '$lib/db';
import { policialUpdateSchema } from '$lib/schemas/policial';
import type { RequestHandler } from './$types';

async function verificarPermissao(db: Database, policialId: number, locals: App.Locals): Promise<Response | null> {
	if (locals.usuario?.tipo === 'policial') {
		const policial = await buscarPolicial(db, policialId);
		if (policial && policial.lotacao !== locals.usuario.lotacao) {
			return json({ error: 'Sem permissão' }, { status: 403 }) as Response;
		}
	}
	return null;
}

export const GET: RequestHandler = async ({ platform, params, locals }) => {
	const db = getDB(platform);
	const id = Number(params.id);

	const bloqueio = await verificarPermissao(db, id, locals);
	if (bloqueio) return bloqueio;

	const policial = await buscarPolicial(db, id);
	if (!policial) return json({ error: 'Policial não encontrado' }, { status: 404 });
	return json(policial);
};

export const PUT: RequestHandler = async ({ platform, params, request, locals }) => {
	const db = getDB(platform);
	const id = Number(params.id);

	const bloqueio = await verificarPermissao(db, id, locals);
	if (bloqueio) return bloqueio;

	const data = await request.json();
	const parsed = policialUpdateSchema.safeParse(data);
	if (!parsed.success) {
		return json({ error: parsed.error.issues[0].message }, { status: 400 });
	}

	// Policial não pode mudar lotação
	if (locals.usuario?.tipo === 'policial' && data.lotacao && data.lotacao !== locals.usuario.lotacao) {
		return json({ error: 'Você não pode alterar a lotação' }, { status: 403 });
	}

	try {
		await atualizarPolicial(db, id, parsed.data);
		return json({ success: true });
	} catch (e: unknown) {
		const message = e instanceof Error ? e.message : 'Erro desconhecido';
		if (message.includes('UNIQUE')) {
			return json({ error: 'Matrícula já cadastrada' }, { status: 409 });
		}
		return json({ error: message }, { status: 500 });
	}
};

export const DELETE: RequestHandler = async ({ platform, params, locals }) => {
	const db = getDB(platform);
	const id = Number(params.id);

	const bloqueio = await verificarPermissao(db, id, locals);
	if (bloqueio) return bloqueio;

	await excluirPolicial(db, id);
	return json({ success: true });
};
