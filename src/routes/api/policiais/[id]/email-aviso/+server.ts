/**
 * GET /api/policiais/[id]/email-aviso
 *
 * Retorna e-mail pessoal e institucional para pré-preencher avisos GISE (assessor).
 * Exclusivo do Administrador Geral — não expõe e-mails na busca geral de policiais.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { getDB } from '$lib/db';
import { isAdminGeral } from '$lib/auth';
import { policiais } from '$lib/server/schema';

export const GET: RequestHandler = async ({ locals, platform, params }) => {
	const u = locals.usuario;
	if (!u || !isAdminGeral(u)) {
		return json({ error: 'Não autorizado' }, { status: 403 });
	}

	const id = parseInt(params.id ?? '', 10);
	if (Number.isNaN(id) || id < 1) {
		return json({ error: 'ID inválido' }, { status: 400 });
	}

	const db = getDB(platform);
	const row = await db
		.select({
			email_pessoal: policiais.email_pessoal,
			email: policiais.email
		})
		.from(policiais)
		.where(eq(policiais.id, id))
		.get();

	if (!row) {
		return json({ error: 'Policial não encontrado' }, { status: 404 });
	}

	return json({
		email_pessoal: row.email_pessoal,
		email: row.email
	});
};
