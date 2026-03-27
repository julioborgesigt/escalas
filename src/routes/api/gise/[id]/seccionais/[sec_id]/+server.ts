/**
 * PATCH  /api/gise/[id]/seccionais/[sec_id]
 *   → Admin Seccional: define unidade operacional, adiciona/remove membros das equipes
 *   → Admin Geral: todas as operações acima + alterar slots
 *
 * POST /api/gise/[id]/seccionais/[sec_id]/submit
 *   → Admin Seccional finaliza o preenchimento da sua seccional
 *   → Verifica se todas as seccionais finalizaram → muda status para aguardando_assinatura
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	getDB,
	buscarGiseEscala,
	atualizarGiseSeccional,
	atualizarGiseEquipe,
	adicionarGiseMembro,
	removerGiseMembro,
	verificarGiseCompleta,
	atualizarGiseEscala,
	excluirGiseEquipe
} from '$lib/db';
import { isAdminGeral, isAdminSeccional } from '$lib/auth';
import { giseSeccionais, giseEquipes, giseMembros, policiais, unidades } from '$lib/server/schema';
import { eq, and } from 'drizzle-orm';

export const PATCH: RequestHandler = async ({ locals, params, request, platform }) => {
	const u = locals.usuario;
	const giseId = parseInt(params.id);
	const secId = parseInt(params.sec_id);

	if (!u || (!isAdminGeral(u) && !isAdminSeccional(u))) {
		return json({ error: 'Sem permissão' }, { status: 403 });
	}

	const db = getDB(platform);

	// Verificar existência da seccional nesta GISE
	const sec = await db
		.select()
		.from(giseSeccionais)
		.where(and(eq(giseSeccionais.id, secId), eq(giseSeccionais.gise_id, giseId)))
		.get();
	if (!sec) return json({ error: 'Seccional não encontrada nesta GISE' }, { status: 404 });

	// Admin Seccional: verificar que é da mesma seccional
	if (isAdminSeccional(u) && u.papel_unidade_id !== sec.seccional_id) {
		return json({ error: 'Sem permissão para editar esta seccional' }, { status: 403 });
	}

	const gise = await buscarGiseEscala(db, giseId);
	if (!gise) return json({ error: 'GISE não encontrada' }, { status: 404 });
	if (gise.status === 'finalizada' || gise.status === 'assinada') {
		return json({ error: 'Escala já está fechada para edição' }, { status: 400 });
	}

	const body = await request.json();
	const {
		unidade_operacional_id,
		supervisor_sabado_id,
		supervisor_domingo_id,
		equipes,
		adicionar_membro,
		remover_membro_id
	} = body as {
		unidade_operacional_id?: number | null;
		supervisor_sabado_id?: number | null;
		supervisor_domingo_id?: number | null;
		equipes?: Array<{ id: number; slots_dpc: number; slots_oip: number }>;
		adicionar_membro?: { equipe_id: number; policial_id: number; dia?: 'sabado' | 'domingo' | 'ambos' };
		remover_membro_id?: number;
	};

	// Atualizar unidade operacional
	if (unidade_operacional_id !== undefined) {
		await atualizarGiseSeccional(db, secId, { unidade_operacional_id });
	}

	// Supervisor: apenas Admin Seccional ou Admin Geral podem definir (DPC obrigatório)
	if (supervisor_sabado_id !== undefined || supervisor_domingo_id !== undefined) {
		for (const [campo, valor] of [
			['supervisor_sabado_id', supervisor_sabado_id],
			['supervisor_domingo_id', supervisor_domingo_id]
		] as const) {
			if (valor != null) {
				const p = await db
					.select({ cargo: policiais.cargo })
					.from(policiais)
					.where(eq(policiais.id, valor))
					.get();
				if (!p) return json({ error: `Policial (${campo}) não encontrado` }, { status: 404 });
				if (p.cargo !== 'DPC') {
					return json({ error: 'Supervisor deve ser DPC' }, { status: 400 });
				}
			}
		}
		const updateGise: Record<string, unknown> = {};
		if (supervisor_sabado_id !== undefined) updateGise.supervisor_sabado_id = supervisor_sabado_id;
		if (supervisor_domingo_id !== undefined) updateGise.supervisor_domingo_id = supervisor_domingo_id;
		await atualizarGiseEscala(db, giseId, updateGise as any);
	}

	// Atualizar slots de equipes (Admin Geral somente)
	if (equipes && isAdminGeral(u)) {
		for (const eq_ of equipes) {
			await atualizarGiseEquipe(db, eq_.id, eq_.slots_dpc, eq_.slots_oip);
		}
	}

	// Adicionar membro à equipe
	if (adicionar_membro) {
		const { equipe_id, policial_id, dia = 'ambos' } = adicionar_membro;
		// Verificar que a equipe pertence a esta seccional
		const equipe = await db
			.select()
			.from(giseEquipes)
			.where(and(eq(giseEquipes.id, equipe_id), eq(giseEquipes.gise_seccional_id, secId)))
			.get();
		if (!equipe) return json({ error: 'Equipe não encontrada nesta seccional' }, { status: 404 });
		await adicionarGiseMembro(db, equipe_id, policial_id, dia);
	}

	// Remover membro
	if (remover_membro_id) {
		// Verificar que o membro pertence a uma equipe desta seccional
		const membro = await db
			.select({ equipe_id: giseMembros.equipe_id })
			.from(giseMembros)
			.where(eq(giseMembros.id, remover_membro_id))
			.get();
		if (membro) {
			const equipe = await db
				.select({ gise_seccional_id: giseEquipes.gise_seccional_id })
				.from(giseEquipes)
				.where(eq(giseEquipes.id, membro.equipe_id))
				.get();
			if (!equipe || equipe.gise_seccional_id !== secId) {
				return json({ error: 'Membro não pertence a esta seccional' }, { status: 403 });
			}
		}
		await removerGiseMembro(db, remover_membro_id);
	}

	return json({ ok: true });
};

/** POST /api/gise/[id]/seccionais/[sec_id] com action=submit → finaliza seccional */
export const POST: RequestHandler = async ({ locals, params, request, platform }) => {
	const u = locals.usuario;
	const giseId = parseInt(params.id);
	const secId = parseInt(params.sec_id);

	if (!u || (!isAdminGeral(u) && !isAdminSeccional(u))) {
		return json({ error: 'Sem permissão' }, { status: 403 });
	}

	const db = getDB(platform);

	const sec = await db
		.select()
		.from(giseSeccionais)
		.where(and(eq(giseSeccionais.id, secId), eq(giseSeccionais.gise_id, giseId)))
		.get();
	if (!sec) return json({ error: 'Seccional não encontrada' }, { status: 404 });

	if (isAdminSeccional(u) && u.papel_unidade_id !== sec.seccional_id) {
		return json({ error: 'Sem permissão para esta seccional' }, { status: 403 });
	}

	// Marcar seccional como preenchida
	await atualizarGiseSeccional(db, secId, { status: 'preenchida' });

	// Verificar se todas as seccionais estão preenchidas
	const todasPreenchidas = await verificarGiseCompleta(db, giseId);
	if (todasPreenchidas) {
		await atualizarGiseEscala(db, giseId, { status: 'aguardando_assinatura' });
		return json({ ok: true, gise_status: 'aguardando_assinatura' });
	}

	return json({ ok: true, gise_status: 'em_preenchimento' });
};
