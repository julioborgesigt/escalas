/**
 * GET /api/gise/[id]/documento-assinado/info
 *
 * Retorna informações sobre os documentos assinados da GISE (se existe, quem assinou, etc. para sáb/dom)
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
	const documentos = await db.select().from(schema.giseDocumentos).where(eq(schema.giseDocumentos.gise_id, id));

	if (documentos.length === 0) {
		return json({ existe: false });
	}

	const docsMapped: Record<string, any> = {};
	for (const doc of documentos) {
		docsMapped[doc.dia] = {
			existe: true,
			assinante_nome: doc.assinante_nome,
			assinante_cpf: doc.assinante_cpf ?? '',
			data: doc.created_at,
			verificacao_hash: doc.verificacao_hash
		};
	}

	return json({
		existe: true,
		documentos: docsMapped
	});
};
