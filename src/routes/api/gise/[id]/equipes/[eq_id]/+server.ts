/**
 * PATCH  /api/gise/[id]/equipes/[eq_id]  → atualiza slots (Admin Geral)
 * DELETE /api/gise/[id]/equipes/[eq_id]  → remove equipe (Admin Geral)
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDB, buscarGiseEscala, atualizarGiseEquipe, excluirGiseEquipe } from '$lib/db';
import { isAdminGeral } from '$lib/auth';
import { giseEquipes } from '$lib/server/schema';
import { eq } from 'drizzle-orm';

export const PATCH: RequestHandler = async ({ locals, params, request, platform }) => {
	const u = locals.usuario;
	if (!isAdminGeral(u)) return json({ error: 'Sem permissão' }, { status: 403 });

	const giseId = parseInt(params.id);
	const eqId = parseInt(params.eq_id);
	if (isNaN(giseId) || isNaN(eqId)) return json({ error: 'ID inválido' }, { status: 400 });

	const db = getDB(platform);
	const gise = await buscarGiseEscala(db, giseId);
	if (!gise || gise.status === 'finalizada') {
		return json({ error: 'GISE não disponível para edição' }, { status: 400 });
	}

	const { slots_dpc, slots_oip } = await request.json();
	await atualizarGiseEquipe(db, eqId, slots_dpc ?? 0, slots_oip ?? 0);
	return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ locals, params, platform }) => {
	const u = locals.usuario;
	if (!isAdminGeral(u)) return json({ error: 'Sem permissão' }, { status: 403 });

	const giseId = parseInt(params.id);
	const eqId = parseInt(params.eq_id);
	if (isNaN(giseId) || isNaN(eqId)) return json({ error: 'ID inválido' }, { status: 400 });

	const db = getDB(platform);
	const gise = await buscarGiseEscala(db, giseId);
	if (!gise || gise.status === 'finalizada') {
		return json({ error: 'GISE não disponível para edição' }, { status: 400 });
	}

	await excluirGiseEquipe(db, eqId);
	return json({ ok: true });
};
