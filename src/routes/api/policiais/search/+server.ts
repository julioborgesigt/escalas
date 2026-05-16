/**
 * GET /api/policiais/search
 *
 * Busca paginada de policiais ativos. Substitui o anti-padrão de carregar
 * 10 000 policiais no `load()` para então filtrar no cliente.
 *
 * Auth: usuário autenticado (qualquer tipo).
 *
 * RBAC:
 *  - Admin geral / seccional / unidade: pode buscar todos os servidores sem
 *    restrição de escopo (servidores podem atuar fora da própria lotação).
 *  - Policial comum: só pode buscar policiais da própria lotação.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { getDB, listarPoliciais } from '$lib/db';
import { isAdminGeral, isAdminSeccional, isAdminUnidade } from '$lib/auth';
import { policialSearchQuerySchema } from '$lib/schemas';
import { requireAuth, badRequest, forbidden } from '$lib/server/api';

export const GET: RequestHandler = async ({ locals, platform, url }) => {
	const u = requireAuth(locals);
	if (u instanceof Response) return u;

	const parsed = policialSearchQuerySchema.safeParse(Object.fromEntries(url.searchParams));
	if (!parsed.success) return badRequest(parsed.error.issues[0].message);

	const { q, cargo, page, limit, somente_admins } = parsed.data;
	let { lotacao, seccional_id } = parsed.data;

	const db = getDB(platform);
	// Qualquer tipo de admin pode buscar todos os servidores sem restrição de escopo.
	const isGeral = isAdminGeral(u) || isAdminSeccional(u) || isAdminUnidade(u);

	if (!isGeral) {
		// Policial comum: só vê a própria lotação.
		if (lotacao && lotacao !== u.lotacao) return forbidden('Sem permissão para esta lotação');

		lotacao = u.lotacao;
		seccional_id = undefined;

		const temBusca = !!(q && q.length >= 2);
		if (!temBusca && !lotacao && !seccional_id) {
			return badRequest('Informe um termo de busca ou lotação');
		}
	}

	const result = await listarPoliciais(db, lotacao, false, {
		busca: q,
		cargo,
		seccionalId: seccional_id,
		somentePapel: somente_admins,
		page,
		limit
	});

	// Devolve apenas os campos que a UI consome (evita vazar email, etc.).
	const enxuto = result.policiais.map((p) => ({
		id: p.id,
		nome: p.nome,
		matricula: p.matricula,
		cargo: p.cargo,
		lotacao: p.lotacao
	}));

	return json({
		policiais: enxuto,
		total: result.total,
		page: result.page,
		limit: result.limit,
		totalPages: result.totalPages
	});
};

