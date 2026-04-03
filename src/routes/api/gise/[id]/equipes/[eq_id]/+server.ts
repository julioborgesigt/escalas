/**
 * PATCH  /api/gise/[id]/equipes/[eq_id]  → atualiza slots e horários (Admin Geral)
 * DELETE /api/gise/[id]/equipes/[eq_id]  → remove equipe (Admin Geral)
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDB, buscarGiseEscala, atualizarGiseEquipe, excluirGiseEquipe, atualizarGiseEscala } from '$lib/db';
import { isAdminGeral } from '$lib/auth';
import { giseDocumentos } from '$lib/server/schema';
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

	const { slots_dpc, slots_oip, hora_entrada, hora_saida } = await request.json();

	const customHours: any = {};
	if (hora_entrada !== undefined) customHours.hora_entrada = hora_entrada;
	if (hora_saida !== undefined) customHours.hora_saida = hora_saida;

	await atualizarGiseEquipe(db, eqId, slots_dpc, slots_oip, Object.keys(customHours).length ? customHours : undefined);

	// Se a escala estava pronta para assinatura ou além, volta para preenchimento ao alterar equipe
	const statusString = gise.status as string;
	if (statusString === 'aguardando_assinatura' || statusString === 'em_andamento' || statusString === 'aguardando_relatorios' || statusString === 'aguardando_assinatura_relat' || statusString === 'pronta_para_finalizar' || statusString === 'finalizada') {
		await db.delete(giseDocumentos).where(eq(giseDocumentos.gise_id, giseId));
		await atualizarGiseEscala(db, giseId, { status: 'em_preenchimento' });
	}

	return json({ ok: true, assinatura_revogada: true });
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
