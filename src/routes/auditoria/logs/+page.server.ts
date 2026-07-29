/**
 * Console de logs técnicos — consulta `app_log` (warn/error do logger de
 * servidor, persistidos por request em hooks.server.ts).
 *
 * Acesso restrito ao SUPER ADMIN, como o console de auditoria — não ao Admin
 * Geral, que não alcança nenhum dos dois consoles. Filtros na query
 * string (GET): estado compartilhável por link. O `request_id` correlaciona com
 * a trilha forense (/auditoria) e com o `errorId` que o usuário vê em erros 5xx.
 */
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getDB, listarAppLogs, resumoAppLogs } from '$lib/db';

const PER_PAGE = 25;

/** `ate` só com data (10 chars) vira fim do dia, para o intervalo ser inclusivo. */
function fimDoDia(s: string | null): string | undefined {
	if (!s) return undefined;
	return s.length === 10 ? `${s} 23:59:59` : s;
}

export const load: PageServerLoad = async ({ locals, platform, url }) => {
	const u = locals.usuario;
	if (!u) redirect(302, '/login');
	if (!u.isSuperAdmin) redirect(302, '/');

	const db = getDB(platform);
	const q = url.searchParams;

	const filtros = {
		level: q.get('level') || undefined,
		busca: q.get('busca') || undefined,
		request_id: q.get('request_id') || undefined,
		de: q.get('de') || undefined,
		ate: q.get('ate') || undefined,
		page: q.get('page') ? Math.max(1, Number(q.get('page'))) : 1
	};

	const [resultado, resumo] = await Promise.all([
		listarAppLogs(db, { ...filtros, ate: fimDoDia(q.get('ate')), limit: PER_PAGE }),
		resumoAppLogs(db)
	]);

	return { ...resultado, resumo, filtros };
};
