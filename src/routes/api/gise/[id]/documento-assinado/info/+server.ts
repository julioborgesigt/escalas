/**
 * GET /api/gise/[id]/documento-assinado/info
 *
 * Retorna informações sobre o documento assinado da GISE (se existe, quem assinou, etc.)
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDB } from '$lib/db';
import * as schema from '$lib/server/schema';
import { eq } from 'drizzle-orm';
import { requireAuth, badRequest } from '$lib/server/api';

export const GET: RequestHandler = async ({ params, locals, platform }) => {
	const u = requireAuth(locals);
	if (u instanceof Response) return u;

	const id = parseInt(params.id!);
	if (isNaN(id)) return badRequest('ID inválido');

	const db = getDB(platform);
	const doc = await db.select().from(schema.giseDocumentos).where(eq(schema.giseDocumentos.gise_id, id)).get();

	if (!doc) {
		return json({ existe: false });
	}

	return json({
		existe: true,
		assinante_nome: doc.assinante_nome,
		assinante_cpf: doc.assinante_cpf ?? '',
		data: doc.created_at,
		verificacao_hash: doc.verificacao_hash
	});
};
