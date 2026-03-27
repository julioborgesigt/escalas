/**
 * GET /api/gise/[id]/documento-assinado/info
 *
 * Retorna informações sobre o documento assinado da GISE (se existe, quem assinou, etc.)
 */

import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { getDB, buscarGiseDocumento } from '$lib/db';

export const GET = async ({ params, locals, platform }: RequestEvent) => {
	const u = locals.usuario;
	if (!u) return json({ error: 'Não autorizado' }, { status: 401 });

	const id = parseInt(params.id!);
	if (isNaN(id)) return json({ error: 'ID inválido' }, { status: 400 });

	const db = getDB(platform);
	const documento = await buscarGiseDocumento(db, id);

	if (!documento) {
		return json({ existe: false });
	}

	return json({
		existe: true,
		assinante_nome: documento.assinante_nome,
		assinante_cpf: documento.assinante_cpf ?? '',
		data: documento.created_at,
		verificacao_hash: documento.verificacao_hash
	});
};
