/**
 * GET /api/admin/lgpd/solicitacoes — lista todas as solicitações (admin geral)
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDB } from '$lib/db';
import { listarSolicitacoes } from '$lib/db/lgpd-solicitacoes';
import { requireAdmin } from '$lib/server/api';

export const GET: RequestHandler = async ({ platform, locals }) => {
	const u = requireAdmin(locals);
	if (u instanceof Response) return u;

	const db = getDB(platform);
	const solicitacoes = await listarSolicitacoes(db);
	return json({ solicitacoes });
};
