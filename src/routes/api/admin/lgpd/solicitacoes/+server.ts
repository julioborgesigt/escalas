/**
 * GET /api/admin/lgpd/solicitacoes — lista todas as solicitações (admin geral)
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDB } from '$lib/db';
import { isAdminGeral } from '$lib/auth';
import { listarSolicitacoes } from '$lib/db/lgpd-solicitacoes';

export const GET: RequestHandler = async ({ platform, locals }) => {
	const u = locals.usuario;
	if (!u || !isAdminGeral(u)) return json({ error: 'Acesso restrito' }, { status: 403 });

	const db = getDB(platform);
	const solicitacoes = await listarSolicitacoes(db);
	return json({ solicitacoes });
};
