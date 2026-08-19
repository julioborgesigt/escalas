/**
 * Console de auditoria — consulta a trilha forense (`audit_log`).
 *
 * Acesso restrito ao SUPER ADMIN — não ao Admin Geral (mesma política do
 * endpoint /api/admin/audit, que usa `requireSuperAdmin`).
 * Os filtros viajam pela query string (GET), então o estado é compartilhável por
 * link e sobrevive a reload. A verificação de integridade da cadeia de hash é
 * exposta como server action.
 */
import { redirect, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import {
	getDB,
	listarAuditLog,
	resumoAuditoria,
	eventosCriticosRecentes,
	verificarIntegridadeAudit,
	CATALOGO_ACOES,
	type AuditCriptoEnv
} from '$lib/db';
import { PER_PAGE, fimDoDia } from './_components/consulta';

export const load: PageServerLoad = async ({ locals, platform, url }) => {
	const u = locals.usuario;
	if (!u) redirect(302, '/login');
	if (!u.isSuperAdmin) redirect(302, '/');

	const db = getDB(platform);
	const q = url.searchParams;

	const filtros = {
		categoria: q.get('categoria') || undefined,
		acao: q.get('acao') || undefined,
		severidade: q.get('severidade') || undefined,
		resultado: q.get('resultado') || undefined,
		actor_tipo: q.get('actor_tipo') || undefined,
		busca: q.get('busca') || undefined,
		de: q.get('de') || undefined,
		ate: q.get('ate') || undefined,
		page: q.get('page') ? Math.max(1, Number(q.get('page'))) : 1
	};

	const [resultado, resumo, criticosRecentes] = await Promise.all([
		listarAuditLog(db, { ...filtros, ate: fimDoDia(q.get('ate')), limit: PER_PAGE }),
		resumoAuditoria(db),
		eventosCriticosRecentes(db, 5)
	]);

	// Facetas derivadas do catálogo central de ações.
	const categorias = [...new Set(Object.values(CATALOGO_ACOES).map((m) => m.categoria))].sort();
	const acoes = Object.entries(CATALOGO_ACOES)
		.map(([valor, m]) => ({ valor, label: m.label, categoria: m.categoria }))
		.sort((a, b) => a.label.localeCompare(b.label));

	return { ...resultado, resumo, criticosRecentes, filtros, facetas: { categorias, acoes } };
};

export const actions: Actions = {
	verificar: async ({ locals, platform }) => {
		const u = locals.usuario;
		if (!u || !u.isSuperAdmin) return fail(403, { error: 'Acesso restrito' });
		const db = getDB(platform);
		const integridade = await verificarIntegridadeAudit(
			db,
			platform?.env as AuditCriptoEnv | undefined
		);
		return { integridade };
	}
};
