import { json } from '@sveltejs/kit';
import { getDB, listarPoliciais, criarPolicial, excluirPolicial, registrarAuditComContexto } from '$lib/db';
import { policialSchema } from '$lib/schemas';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ platform, url, locals }) => {
	const db = getDB(platform);
	const usuario = locals.usuario;

	// Parâmetro todos=1 permite listar todos os policiais (para inclusão em escalas)
	const todos = url.searchParams.get('todos') === '1';
	// Parâmetro sem_lotacao=1 lista apenas policiais sem lotação (admin only)
	const semLotacao = url.searchParams.get('sem_lotacao') === '1';
	// Busca por nome ou matrícula
	const busca = url.searchParams.get('busca') || undefined;
	// Paginação
	const page = url.searchParams.get('page') ? Number(url.searchParams.get('page')) : undefined;
	const limit = url.searchParams.get('limit') ? Number(url.searchParams.get('limit')) : undefined;

	let lotacao = url.searchParams.get('lotacao') || undefined;
	if (usuario?.tipo === 'policial' && !todos) {
		lotacao = usuario.lotacao;
	}

	const resultado = await listarPoliciais(db, lotacao, semLotacao && usuario?.tipo === 'admin', {
		busca,
		page,
		limit
	});
	return json(resultado);
};

export const POST: RequestHandler = async ({ platform, request, locals }) => {
	const db = getDB(platform);
	const usuario = locals.usuario;
	const data = await request.json();

	const parsed = policialSchema.safeParse(data);
	if (!parsed.success) {
		return json({ error: parsed.error.issues[0].message }, { status: 400 });
	}

	// Policial só pode cadastrar na sua lotação
	if (usuario?.tipo === 'policial' && data.lotacao !== usuario.lotacao) {
		return json({ error: 'Você só pode cadastrar policiais na sua lotação' }, { status: 403 });
	}

	try {
		await criarPolicial(db, { ...parsed.data, email: data.email || null });
		await registrarAuditComContexto(db, {
			usuario: usuario,
			acao: 'criar_policial',
			entidade: 'policial',
			detalhes: `Criado policial: ${parsed.data.nome} (matrícula: ${parsed.data.matricula})`
		});
		return json({ success: true }, { status: 201 });
	} catch (e: unknown) {
		console.error('[POST /api/policiais] erro ao criar policial:', e);
		const message = e instanceof Error ? e.message : String(e);
		if (message.includes('UNIQUE')) {
			return json({ error: 'Matrícula já cadastrada' }, { status: 409 });
		}
		return json({ error: 'Erro interno ao criar policial' }, { status: 500 });
	}
};
