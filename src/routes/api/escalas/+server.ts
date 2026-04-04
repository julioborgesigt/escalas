import { json } from '@sveltejs/kit';
import { getDB, listarEscalas, criarEscala, excluirEscala, verificarEscalaExistente } from '$lib/db';
import { escalaSchema } from '$lib/schemas';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ platform, url, locals }) => {
	const db = getDB(platform);
	const usuario = locals.usuario;

	// Se for policial, filtra obrigatoriamente pela sua lotação.
	// Se for admin, usa o filtro vindo da query string (se houver).
	let lotacao = url.searchParams.get('lotacao') || undefined;
	const statusParam = url.searchParams.get('status');
	const status = (statusParam === 'pendente' || statusParam === 'assinada') ? statusParam : undefined;
	const mes = url.searchParams.get('mes') ? Number(url.searchParams.get('mes')) : undefined;
	const ano = url.searchParams.get('ano') ? Number(url.searchParams.get('ano')) : undefined;
	const tipo = url.searchParams.get('tipo') || undefined;
	const vistoParam = url.searchParams.get('visto');
	const visto = vistoParam !== null ? vistoParam === 'true' : undefined;
	const depois = url.searchParams.get('depois') || undefined;

	if (usuario?.tipo === 'policial') {
		lotacao = usuario.lotacao;
	}

	const escalas = await listarEscalas(db, lotacao, status, mes, ano, tipo, visto, depois);
	return json(escalas);
};

export const POST: RequestHandler = async ({ platform, request, locals }) => {
	const db = getDB(platform);
	const usuario = locals.usuario;
	const data = await request.json();

	const parsed = escalaSchema.safeParse(data);
	if (!parsed.success) {
		return json({ error: parsed.error.issues[0].message }, { status: 400 });
	}

	const validated = parsed.data;

	// Policial cria escala da sua lotação; admin deve informar
	if (usuario?.tipo === 'policial') {
		validated.lotacao = usuario.lotacao!;
	}

	// Valida unicidade: uma escala por tipo/período por unidade
	if (validated.tipo && validated.lotacao) {
		const existente = await verificarEscalaExistente(
			db,
			validated.lotacao,
			validated.tipo as 'plantao' | 'expediente' | 'fds',
			validated.data_inicio
		);
		if (existente) {
			const periodo =
				validated.tipo === 'fds'
					? 'nesta semana'
					: 'neste mês';
			const tipoLabel =
				validated.tipo === 'plantao' ? 'Plantão' :
				validated.tipo === 'expediente' ? 'Expediente' : 'Final de Semana';
			return json(
				{ error: `Já existe uma Escala de ${tipoLabel} para ${validated.lotacao} ${periodo}.` },
				{ status: 409 }
			);
		}
	}

	try {
		const result = await criarEscala(db, {
			titulo: validated.titulo,
			cidade: validated.cidade,
			data_inicio: validated.data_inicio,
			data_fim: validated.data_fim,
			horario: validated.horario || `${validated.hora_entrada}H A ${validated.hora_saida}H`,
			hora_entrada: validated.hora_entrada,
			hora_saida: validated.hora_saida,
			lotacao: validated.lotacao,
			tipo: validated.tipo
		});

		return json({ success: true, id: result[0]?.id }, { status: 201 });
	} catch (err) {
		console.error('[POST /api/escalas] erro ao criar escala:', err);
		const message = err instanceof Error ? err.message : String(err);
		return json({ error: 'Erro interno ao criar escala' }, { status: 500 });
	}
};

export const DELETE: RequestHandler = async ({ platform, url, locals }) => {
	const db = getDB(platform);
	const id = url.searchParams.get('id');
	if (!id) return json({ error: 'ID obrigatório' }, { status: 400 });

	// Policial só pode excluir escalas da sua lotação
	if (locals.usuario?.tipo === 'policial') {
		const { buscarEscala } = await import('$lib/db');
		const escala = await buscarEscala(db, Number(id));
		if (escala && escala.lotacao !== locals.usuario.lotacao) {
			return json({ error: 'Sem permissão' }, { status: 403 });
		}
	}

	await excluirEscala(db, Number(id));
	return json({ success: true });
};
