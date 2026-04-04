/**
 * DELETE /api/gise/[id]/membros/[mem_id]  → remove membro de equipe
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDB, buscarGiseEscala, removerGiseMembro, atualizarGiseEscala, revogarAssinaturasSeccional } from '$lib/db';
import { isAdminGeral, isAdminSeccional } from '$lib/auth';
import { giseMembros, giseEquipes, giseSeccionais, giseDocumentos } from '$lib/server/schema';
import { eq, and } from 'drizzle-orm';

export const DELETE: RequestHandler = async ({ locals, params, platform }) => {
	const u = locals.usuario;
	if (!u || (!isAdminGeral(u) && !isAdminSeccional(u))) {
		return json({ error: 'Sem permissão' }, { status: 403 });
	}

	const giseId = parseInt(params.id);
	const memId = parseInt(params.mem_id);
	if (isNaN(giseId) || isNaN(memId)) return json({ error: 'ID inválido' }, { status: 400 });

	const db = getDB(platform);
	const gise = await buscarGiseEscala(db, giseId);
	if (!gise || gise.status === 'finalizada' || gise.status === 'em_andamento' || gise.status === 'aguardando_relatorios' || gise.status === 'aguardando_assinatura_relat' || gise.status === 'pronta_para_finalizar') {
		return json({ error: 'Escala não disponível para edição' }, { status: 400 });
	}

	// Verificar jurisdição para Admin Seccional
	if (isAdminSeccional(u)) {
		const membro = await db
			.select({ equipe_id: giseMembros.equipe_id })
			.from(giseMembros)
			.where(eq(giseMembros.id, memId))
			.get();
		if (!membro) return json({ error: 'Membro não encontrado' }, { status: 404 });

		const equipe = await db
			.select({ gise_seccional_id: giseEquipes.gise_seccional_id })
			.from(giseEquipes)
			.where(eq(giseEquipes.id, membro.equipe_id))
			.get();
		if (!equipe) return json({ error: 'Equipe não encontrada' }, { status: 404 });

		const sec = await db
			.select({ seccional_id: giseSeccionais.seccional_id })
			.from(giseSeccionais)
			.where(eq(giseSeccionais.id, equipe.gise_seccional_id))
			.get();
		if (!sec || sec.seccional_id !== u.papel_unidade_id) {
			return json({ error: 'Sem permissão para este membro' }, { status: 403 });
		}
	}

	// Se a escala estava avançada, revogar as assinaturas da seccional relacionada
	const statusString = gise.status as string;
	if (statusString !== 'em_definicao_supervisor' && statusString !== 'em_preenchimento') {
		// Precisamos identificar a qual seccional este membro pertencia para limpar apenas ela
		const membroInfo = await db
			.select({ sec_id: giseEquipes.gise_seccional_id })
			.from(giseMembros)
			.innerJoin(giseEquipes, eq(giseMembros.equipe_id, giseEquipes.id))
			.where(eq(giseMembros.id, memId))
			.get();

		await removerGiseMembro(db, memId);

		if (membroInfo) {
			console.log(`[REVOGAÇÃO] Membro ${memId} removido da seccional ${membroInfo.sec_id}. Revogando assinaturas.`);
			await revogarAssinaturasSeccional(db, giseId, membroInfo.sec_id);
		}
	} else {
		await removerGiseMembro(db, memId);
	}

	return json({ ok: true, assinatura_revogada: true });
};
