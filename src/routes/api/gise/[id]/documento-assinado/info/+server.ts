/**
 * GET /api/gise/[id]/documento-assinado/info
 *
 * Retorna informações sobre o documento assinado da GISE (se existe, quem assinou, etc.)
 */

import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { getDB } from '$lib/db';
import * as schema from '$lib/server/schema';
import { eq } from 'drizzle-orm';

export const GET = async ({ params, locals, platform }: RequestEvent) => {
	const u = locals.usuario;
	if (!u) return json({ error: 'Não autorizado' }, { status: 401 });

	const id = parseInt(params.id!);
	if (isNaN(id)) return json({ error: 'ID inválido' }, { status: 400 });

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
