import { json } from '@sveltejs/kit';
import { getDB, buscarEscala, listarPoliciaisEscala, adicionarPolicialEscala, adicionarMultiplasDatasPlantao, removerPolicialEscala, atualizarEscalaPolicial, adicionarTodosPoliciais, type Database } from '$lib/db';
import { escalaPolicialSchema } from '$lib/schemas';
import type { RequestHandler } from './$types';

async function verificarAcessoEscala(db: Database, escalaId: number, locals: App.Locals): Promise<Response | null> {
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

	// Bulk insert for plantão (array of dates)
	if (data.datas && Array.isArray(data.datas)) {
		if (!data.policial_id) {
			return json({ error: 'policial_id é obrigatório' }, { status: 400 });
		}
		await adicionarMultiplasDatasPlantao(
			db,
			escalaId,
			Number(data.policial_id),
			data.datas,
			data.hora_entrada || '',
			data.hora_saida || '',
			data.equipe || '',
			data.observacoes || ''
		);
		return json({ success: true }, { status: 201 });
	}

	// Single date (existing behavior)
	const parsed = escalaPolicialSchema.safeParse(data);
	if (!parsed.success) {
		return json({ error: parsed.error.issues[0].message }, { status: 400 });
	}

	const validated = parsed.data;
	if (!validated.data_plantao) {
		return json({ error: 'data_plantao é obrigatória' }, { status: 400 });
	}
	await adicionarPolicialEscala(
		db,
		escalaId,
		validated.policial_id,
		validated.data_plantao,
		validated.data_saida || validated.data_plantao,
		validated.hora_entrada,
		validated.hora_saida,
		'',
		validated.equipe || ''
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
		data.hora_saida || '',
		data.observacoes ?? ''
	);
	return json({ success: true });
};

export const PUT: RequestHandler = async ({ platform, params, request, locals }) => {
	const db = getDB(platform);
	const escalaId = Number(params.id);

	const bloqueio = await verificarAcessoEscala(db, escalaId, locals);
	if (bloqueio) return bloqueio;

	const escala = await buscarEscala(db, escalaId);
	if (!escala) return json({ error: 'Escala não encontrada' }, { status: 404 });

	if (escala.tipo !== 'plantao' && escala.tipo !== 'expediente') {
		return json({ error: 'Esta operação só está disponível para escalas de plantão ou expediente' }, { status: 400 });
	}

	const data = await request.json();
	const dataPlantao: string = data.data_plantao || escala.data_inicio;
	const dataSaida: string = data.data_saida || escala.data_inicio;
	const horaEntrada: string = data.hora_entrada || escala.hora_entrada;
	const horaSaida: string = data.hora_saida || escala.hora_saida;

	console.log(`[PUT policiais] escala=${escalaId} tipo="${escala.tipo}" lotacao="${escala.lotacao}"`);

	try {
		const quantidade = await adicionarTodosPoliciais(
			db,
			escalaId,
			escala.lotacao,
			escala.tipo,
			dataPlantao,
			dataSaida,
			horaEntrada,
			horaSaida
		);
		console.log(`[PUT policiais] sucesso quantidade=${quantidade}`);
		return json({ success: true, quantidade }, { status: 200 });
	} catch (e: unknown) {
		const msg = e instanceof Error ? e.message : String(e);
		const stack = e instanceof Error ? e.stack : '';
		console.error('[PUT policiais] erro:', msg);
		console.error('[PUT policiais] stack:', stack);
		return json({ error: 'Erro ao adicionar servidores' }, { status: 500 });
	}
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
