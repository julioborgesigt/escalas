/**
 * GET /api/admin/audit — consulta o log de auditoria.
 *
 * Query params:
 *   - usuario_id: filtra por usuário
 *   - entidade: filtra por tipo de entidade (policial, escala, etc.)
 *   - acao: filtra por ação (login, criar_policial, etc.)
 *   - busca: busca por nome do usuário ou detalhes
 *   - page: página (default 1)
 *   - limit: itens por página (default 20, max 100)
 *
 * Acesso: apenas Admin Geral.
 */

import { json } from '@sveltejs/kit';
import { getDB, listarAuditLog } from '$lib/db';
import { requireAdmin } from '$lib/server/api';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ platform, url, locals }) => {
	const usuario = requireAdmin(locals);
	if (usuario instanceof Response) return usuario;

	const db = getDB(platform);

	const usuario_id = url.searchParams.get('usuario_id')
		? Number(url.searchParams.get('usuario_id'))
		: undefined;
	const entidade = url.searchParams.get('entidade') || undefined;
	const acao = url.searchParams.get('acao') || undefined;
	const busca = url.searchParams.get('busca') || undefined;
	const page = url.searchParams.get('page') ? Number(url.searchParams.get('page')) : undefined;
	const limit = url.searchParams.get('limit') ? Number(url.searchParams.get('limit')) : undefined;

	const resultado = await listarAuditLog(db, {
		usuario_id,
		entidade,
		acao,
		busca,
		page,
		limit
	});

	return json(resultado);
};
