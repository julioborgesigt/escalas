/**
 * GET /api/policiais/[id]/email-aviso
 *
 * Retorna e-mail pessoal e institucional para pré-preencher avisos GISE (assessor).
 * Exclusivo do Administrador Geral — não expõe e-mails na busca geral de policiais.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { getDB } from '$lib/db';
import { policiais } from '$lib/server/schema';
import { requireSuperAdmin, badRequest, notFound } from '$lib/server/api';

export const GET: RequestHandler = async ({ locals, platform, params }) => {
	const u = requireSuperAdmin(locals);
	if (u instanceof Response) return u;

	const id = parseInt(params.id ?? '', 10);
	if (Number.isNaN(id) || id < 1) return badRequest('ID inválido');

	const db = getDB(platform);
	const row = await db
		.select({
			email_pessoal: policiais.email_pessoal,
			email: policiais.email
		})
		.from(policiais)
		.where(eq(policiais.id, id))
		.get();

	if (!row) return notFound('Policial');

	return json({
		email_pessoal: row.email_pessoal,
		email: row.email
	});
};
