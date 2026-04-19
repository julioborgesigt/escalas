/**
 * GET /api/policiais/search
 *
 * Busca paginada de policiais ativos. Substitui o anti-padrão de carregar
 * 10 000 policiais no `load()` para então filtrar no cliente.
 *
 * Auth: usuário autenticado (qualquer tipo).
 *
 * RBAC:
 *  - Admin geral: pode buscar sem filtro de lotação.
 *  - Admin seccional: pode buscar dentro da própria seccional (servidor força
 *    `seccional_id = u.papel_unidade_id` se nada for informado, ou rejeita
 *    `seccional_id`/`lotacao` que não pertença à sua hierarquia).
 *  - Admin unidade: idem com a própria unidade.
 *  - Policial comum: só pode buscar policiais da própria lotação (servidor
 *    força `lotacao = u.lotacao` se nada for informado).
 *
 * Para evitar dump da tabela inteira, exige-se ao menos um filtro
 * discriminativo (`q >= 2 chars`, `lotacao` ou `seccional_id`) para qualquer
 * usuário NÃO-admin-geral. Admin geral pode listar tudo (uso de admin).
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { eq, or } from 'drizzle-orm';
import { getDB, listarPoliciais } from '$lib/db';
import { isAdminGeral, isAdminSeccional, isAdminUnidade } from '$lib/auth';
import { policialSearchQuerySchema } from '$lib/schemas';
import { unidades } from '$lib/server/schema';

export const GET: RequestHandler = async ({ locals, platform, url }) => {
	const u = locals.usuario;
	if (!u) return json({ error: 'Não autorizado' }, { status: 401 });

	const parsed = policialSearchQuerySchema.safeParse(Object.fromEntries(url.searchParams));
	if (!parsed.success) {
		return json({ error: parsed.error.issues[0].message }, { status: 400 });
	}
	const { q, cargo, page, limit } = parsed.data;
	let { lotacao, seccional_id } = parsed.data;

	const db = getDB(platform);
	const isGeral = isAdminGeral(u);

	// Para usuários NÃO-admin, força escopo padrão e valida solicitações.
	if (!isGeral) {
		if (isAdminSeccional(u) || isAdminUnidade(u)) {
			const ownUnitId = u.papel_unidade_id ?? null;
			if (ownUnitId == null) {
				return json({ error: 'Permissão indefinida' }, { status: 403 });
			}

			// Se admin pediu seccional_id ou lotacao explícito, valida a hierarquia.
			if (seccional_id != null || lotacao) {
				const allowed = await unidadesPermitidasParaAdmin(db, ownUnitId);
				if (seccional_id != null && !allowed.unitIds.has(seccional_id)) {
					return json({ error: 'Sem permissão para esta seccional' }, { status: 403 });
				}
				if (lotacao && !allowed.unitNames.has(lotacao)) {
					return json({ error: 'Sem permissão para esta lotação' }, { status: 403 });
				}
			} else {
				// Default: limita à própria unidade/seccional.
				seccional_id = ownUnitId;
			}
		} else {
			// Policial comum: só vê a própria lotação (a menos que peça a mesma explicitamente).
			if (lotacao && lotacao !== u.lotacao) {
				return json({ error: 'Sem permissão para esta lotação' }, { status: 403 });
			}
			lotacao = u.lotacao;
			seccional_id = undefined;
		}

		// Após escopar, exige filtro discriminativo para evitar dump.
		const temBusca = !!(q && q.length >= 2);
		if (!temBusca && !lotacao && !seccional_id) {
			return json({ error: 'Informe um termo de busca ou lotação' }, { status: 400 });
		}
	}

	const result = await listarPoliciais(db, lotacao, false, {
		busca: q,
		cargo,
		seccionalId: seccional_id,
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

/**
 * Resolve as unidades sob a alçada de um admin (seccional ou unidade).
 * Retorna IDs e nomes para validação rápida.
 */
async function unidadesPermitidasParaAdmin(
	db: ReturnType<typeof getDB>,
	ownUnitId: number
): Promise<{ unitIds: Set<number>; unitNames: Set<string> }> {
	const rows = await db
		.select({ id: unidades.id, nome: unidades.nome })
		.from(unidades)
		.where(or(eq(unidades.id, ownUnitId), eq(unidades.seccional_id, ownUnitId)));

	const unitIds = new Set<number>();
	const unitNames = new Set<string>();
	for (const r of rows) {
		unitIds.add(r.id);
		unitNames.add(r.nome);
	}
	return { unitIds, unitNames };
}
