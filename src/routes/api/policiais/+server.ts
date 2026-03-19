import { json } from '@sveltejs/kit';
import { getDB, listarPoliciais, criarPolicial, excluirPolicial } from '$lib/db';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ platform, url, locals }) => {
	const db = getDB(platform);
	const usuario = locals.usuario;

	// Parâmetro todos=1 permite listar todos os policiais (para inclusão em escalas)
	const todos = url.searchParams.get('todos') === '1';

	let lotacao = url.searchParams.get('lotacao') || undefined;
	if (usuario?.tipo === 'policial' && !todos) {
		lotacao = usuario.lotacao;
	}

	const policiais = await listarPoliciais(db, lotacao);
	return json(policiais);
};

export const POST: RequestHandler = async ({ platform, request, locals }) => {
	const db = getDB(platform);
	const usuario = locals.usuario;
	const data = await request.json();

	if (!data.nome || !data.matricula || !data.cargo || !data.lotacao) {
		return json({ error: 'Campos obrigatórios: nome, matricula, cargo, lotacao' }, { status: 400 });
	}

	if (!['DPC', 'OIP'].includes(data.cargo)) {
		return json({ error: 'Cargo deve ser DPC ou OIP' }, { status: 400 });
	}

	// Policial só pode cadastrar na sua lotação
	if (usuario?.tipo === 'policial' && data.lotacao !== usuario.lotacao) {
		return json({ error: 'Você só pode cadastrar policiais na sua lotação' }, { status: 403 });
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

export const DELETE: RequestHandler = async ({ platform, url, locals }) => {
	const db = getDB(platform);
	const id = url.searchParams.get('id');
	if (!id) return json({ error: 'ID obrigatório' }, { status: 400 });

	// Policial só pode excluir da sua lotação
	if (locals.usuario?.tipo === 'policial') {
		const { buscarPolicial } = await import('$lib/db');
		const policial = await buscarPolicial(db, Number(id));
		if (policial && policial.lotacao !== locals.usuario.lotacao) {
			return json({ error: 'Sem permissão' }, { status: 403 });
		}
	}

	await excluirPolicial(db, Number(id));
	return json({ success: true });
};
