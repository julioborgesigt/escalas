import { redirect, fail } from '@sveltejs/kit';
import { eq, or } from 'drizzle-orm';
import type { PageServerLoad, Actions } from './$types';
import {
	getDB,
	listarEscalas,
	listarUnidades,
	marcarVisto,
	registrarAuditComContexto,
	contextoDeEvento
} from '$lib/db';
import { unidades as unidadesTable } from '$lib/server/schema';
import { excluirEscalaCompleta } from '$lib/server/escalas/exclusao';

/** Itens por página da caixa de entrada (mesmo tamanho da paginação antiga client-side). */
const ITENS_POR_PAGINA = 10;

export const load: PageServerLoad = async ({ locals, platform, url }) => {
	const u = locals.usuario;
	if (!u) redirect(302, '/login');
	if (u.tipo !== 'admin') redirect(302, '/');

	const db = getDB(platform);

	// Filtros e paginação via URL (antes o load trazia TODAS as escalas assinadas
	// sem limite e o filtro era client-side — payload/query cresciam sem teto com
	// o histórico; auditoria de performance, B-2).
	const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
	const mes = Number(url.searchParams.get('mes')) || undefined;
	const ano = Number(url.searchParams.get('ano')) || undefined;
	// Default da caixa de entrada: só não-vistos. `vistos=todos` libera o histórico.
	const mostrarTodas = url.searchParams.get('vistos') === 'todos';
	const seccionalId = Number(url.searchParams.get('seccional')) || undefined;
	const unidadeBusca = url.searchParams.get('unidade')?.trim() || undefined;
	const dataBusca = url.searchParams.get('data')?.trim() || undefined;

	// Filtro por seccional → lista de lotações da seccional (mesmo padrão de /escalas)
	let lotacoes: string[] | undefined;
	if (seccionalId) {
		const rows = await db
			.select({ nome: unidadesTable.nome })
			.from(unidadesTable)
			.where(or(eq(unidadesTable.id, seccionalId), eq(unidadesTable.seccional_id, seccionalId)));
		lotacoes = rows.map((r) => r.nome);
	}

	const [resultado, unidadesLista] = await Promise.all([
		listarEscalas(
			db,
			undefined,
			'assinada',
			mes,
			ano,
			undefined,
			mostrarTodas ? undefined : false,
			undefined,
			{
				page,
				limit: ITENS_POR_PAGINA,
				lotacoes,
				lotacaoBusca: unidadeBusca,
				dataBusca
			}
		),
		listarUnidades(db)
	]);

	return {
		escalas: resultado.escalas,
		total: resultado.total,
		page: resultado.page,
		totalPages: resultado.totalPages,
		limit: resultado.limit,
		unidades: unidadesLista
	};
};

export const actions: Actions = {
	toggleVisto: async ({ request, locals, platform }) => {
		const u = locals.usuario;
		if (u?.tipo !== 'admin') return fail(403, { error: 'Não autorizado' });

		const data = await request.formData();
		const escalaId = Number(data.get('escala_id'));
		const visto = data.get('visto') === 'true';

		if (isNaN(escalaId)) return fail(400, { error: 'ID inválido' });

		const db = getDB(platform);
		await marcarVisto(db, escalaId, visto);
		return { success: true, escalaId, visto };
	},

	excluir: async (event) => {
		const { request, locals, platform } = event;
		const u = locals.usuario;
		if (u?.tipo !== 'admin') return fail(403, { error: 'Não autorizado' });

		const data = await request.formData();
		const escalaId = Number(data.get('escala_id'));
		if (isNaN(escalaId)) return fail(400, { error: 'ID inválido' });

		const db = getDB(platform);

		// Deleta documento do R2 (blob + conferência + selfie) e do banco.
		// R2-1/R2-3: antes apagava só o blob principal, deixando a cópia de
		// conferência e a selfie biométrica órfãs. O helper cobre todos.
		await excluirEscalaCompleta(db, platform, escalaId);

		const { contexto, env } = contextoDeEvento(event);
		await registrarAuditComContexto(db, {
			usuario: u,
			acao: 'excluir_escala',
			entidade: 'escala',
			entidade_id: escalaId,
			alvo_tipo: 'escala',
			alvo_id: escalaId,
			detalhes: `Escala excluída da cx. de entrada: ID ${escalaId}`,
			...contexto,
			env
		});

		return { success: true };
	}
};
