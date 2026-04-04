/**
 * PATCH  /api/gise/[id]/equipes/[eq_id]  → atualiza slots e horários (Admin Geral)
 * DELETE /api/gise/[id]/equipes/[eq_id]  → remove equipe (Admin Geral)
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDB, buscarGiseEscala, atualizarGiseEquipe, excluirGiseEquipe, atualizarGiseEscala, revogarAssinaturasSeccional } from '$lib/db';
import { isAdminGeral } from '$lib/auth';
import { giseDocumentos, giseEquipes, giseSeccionais } from '$lib/server/schema';
import { eq, and } from 'drizzle-orm';

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

	// Se a escala já tinha assinaturas e houve alteração de horários, revogar tudo da seccional relacionada
	const statusString = gise.status as string;
	if (statusString !== 'em_definicao_supervisor' && statusString !== 'em_preenchimento') {
		if (hora_entrada !== undefined || hora_saida !== undefined) {
			const eqSec = await db
				.select({ id: giseSeccionais.seccional_id })
				.from(giseEquipes)
				.innerJoin(giseSeccionais, eq(giseEquipes.gise_seccional_id, giseSeccionais.id))
				.where(eq(giseEquipes.id, eqId))
				.get();
			
			if (eqSec) {
				console.log(`[REVOGAÇÃO] Horários da equipe ${eqId} alterados na seccional ${eqSec.id}. Revogando assinaturas.`);
				await revogarAssinaturasSeccional(db, giseId, eqSec.id);
			}
		} else {
			// Se for apenas alteração de slots, invalidamos apenas a assinatura da escala principal (comportamento v0)
			await db.delete(giseDocumentos).where(eq(giseDocumentos.gise_id, giseId));
			await atualizarGiseEscala(db, giseId, { status: 'em_preenchimento' });
		}
	}

	return json({ ok: true, assinatura_revogada: true });
}

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

	const eqSec = await db
		.select({ id: giseSeccionais.seccional_id })
		.from(giseEquipes)
		.innerJoin(giseSeccionais, eq(giseEquipes.gise_seccional_id, giseSeccionais.id))
		.where(eq(giseEquipes.id, eqId))
		.get();

	await excluirGiseEquipe(db, eqId);

	// Se a equipe sumiu, as assinaturas da seccional devem ser invalidadas
	if (eqSec) {
		const statusString = gise.status as string;
		if (statusString !== 'em_definicao_supervisor' && statusString !== 'em_preenchimento') {
			console.log(`[REVOGAÇÃO] Equipe ${eqId} removida da seccional ${eqSec.id}. Revogando assinaturas.`);
			await revogarAssinaturasSeccional(db, giseId, eqSec.id);
		}
	}

	return json({ ok: true });
}
