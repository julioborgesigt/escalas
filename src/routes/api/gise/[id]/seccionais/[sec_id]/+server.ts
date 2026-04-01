/**
 * PATCH  /api/gise/[id]/seccionais/[sec_id]
 *   → Admin Seccional: define unidade operacional, adiciona/remove membros das equipes
 *   → Admin Geral: todas as operações acima + alterar slots
 *
 * POST /api/gise/[id]/seccionais/[sec_id]
 *   → Admin Seccional finaliza o preenchimento da sua seccional
 *
 * DELETE /api/gise/[id]/seccionais/[sec_id]
 *   → Admin Geral remove a seccional da GISE
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
	excluirGiseEquipe,
	excluirGiseSeccional,
	criarGiseEquipe,
	verificarSlotEquipe,
	verificarConflitoMembroGise
} from '$lib/db';
import { isAdminGeral, isAdminSeccional } from '$lib/auth';
import { giseSeccionais, giseEquipes, giseMembros, policiais, giseDocumentos } from '$lib/server/schema';
import { eq, and } from 'drizzle-orm';

export const PATCH: RequestHandler = async ({ locals, params, request, platform }) => {
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
	if (!sec) return json({ error: 'Seccional não encontrada nesta GISE' }, { status: 404 });

	if (isAdminSeccional(u) && u.papel_unidade_id !== sec.seccional_id) {
		return json({ error: 'Sem permissão para editar esta seccional' }, { status: 403 });
	}

	const gise = await buscarGiseEscala(db, giseId);
	if (!gise) return json({ error: 'GISE não encontrada' }, { status: 404 });

	if (!isAdminGeral(u) && (gise.status === 'finalizada' || gise.status === 'assinada')) {
		return json({ error: 'Escala já está fechada para edição' }, { status: 400 });
	}

	const body = await request.json();
	const {
		unidade_operacional_id,
		equipes,
		adicionar_membro,
		remover_membro_id,
		adicionar_equipe,
		hora_entrada,
		hora_saida
	} = body as {
		unidade_operacional_id?: number | null;
		equipes?: Array<{ id: number; slots_dpc: number; slots_oip: number }>;
		adicionar_membro?: { equipe_id: number; policial_id: number };
		remover_membro_id?: number;
		adicionar_equipe?: { tipo: 'operacional' | 'seint'; slots_dpc: number; slots_oip: number };
		hora_entrada?: string | null;
		hora_saida?: string | null;
	};

	// Detectar se seccional já estava preenchida e está sendo alterada
	const seccionalJaPreenchida = sec.status === 'preenchida' || sec.status === 'retificada' || sec.status === 'preenchida_retificada';
	let revogouAssinatura = false;

	if (seccionalJaPreenchida && isAdminSeccional(u)) {
		await atualizarGiseSeccional(db, secId, { status: 'retificada' });

		const docExistente = await db
			.select({ id: giseDocumentos.id })
			.from(giseDocumentos)
			.where(eq(giseDocumentos.gise_id, giseId))
			.get();

		if (docExistente) {
			await db.delete(giseDocumentos).where(eq(giseDocumentos.gise_id, giseId));
			revogouAssinatura = true;
		}

		if (gise.status === 'aguardando_assinatura' || gise.status === 'assinada') {
			await atualizarGiseEscala(db, giseId, { status: 'em_preenchimento' });
		}
	}

	// Atualizar unidade operacional e horários customizados
	if (unidade_operacional_id !== undefined || hora_entrada !== undefined || hora_saida !== undefined) {
		const secUpdate: any = {};
		if (unidade_operacional_id !== undefined) secUpdate.unidade_operacional_id = unidade_operacional_id;
		if (hora_entrada !== undefined) secUpdate.hora_entrada = hora_entrada;
		if (hora_saida !== undefined) secUpdate.hora_saida = hora_saida;
		await atualizarGiseSeccional(db, secId, secUpdate);
	}

	// Atualizar slots de equipes (Admin Geral somente)
	if (equipes && isAdminGeral(u)) {
		for (const eq_ of equipes) {
			await atualizarGiseEquipe(db, eq_.id, eq_.slots_dpc, eq_.slots_oip);
		}
	}

	// Adicionar membro à equipe
	if (adicionar_membro) {
		const { equipe_id, policial_id } = adicionar_membro;

		const equipe = await db
			.select()
			.from(giseEquipes)
			.where(and(eq(giseEquipes.id, equipe_id), eq(giseEquipes.gise_seccional_id, secId)))
			.get();
		if (!equipe) return json({ error: 'Equipe não encontrada nesta seccional' }, { status: 404 });

		const slotCheck = await verificarSlotEquipe(db, equipe_id, policial_id);
		if (!slotCheck.ok) {
			return json({ error: slotCheck.motivo }, { status: 400 });
		}

		const conflitoCheck = await verificarConflitoMembroGise(db, giseId, policial_id);
		if (!conflitoCheck.ok) {
			return json({ error: conflitoCheck.motivo }, { status: 400 });
		}

		await adicionarGiseMembro(db, equipe_id, policial_id);
	}

	// Adicionar equipe (Admin Geral somente)
	if (adicionar_equipe && isAdminGeral(u)) {
		const { tipo, slots_dpc, slots_oip } = adicionar_equipe;
		if (tipo !== 'operacional' && tipo !== 'seint') {
			return json({ error: 'Tipo de equipe inválido' }, { status: 400 });
		}
		await criarGiseEquipe(db, secId, tipo, slots_dpc ?? 0, slots_oip ?? 0);
	}

	// Remover membro
	if (remover_membro_id) {
		const membro = await db
			.select({ equipe_id: giseMembros.equipe_id })
			.from(giseMembros)
			.where(eq(giseMembros.id, remover_membro_id))
			.get();
		if (membro) {
			const equipeCheck = await db
				.select({ gise_seccional_id: giseEquipes.gise_seccional_id })
				.from(giseEquipes)
				.where(eq(giseEquipes.id, membro.equipe_id))
				.get();
			if (!equipeCheck || equipeCheck.gise_seccional_id !== secId) {
				return json({ error: 'Membro não pertence a esta seccional' }, { status: 403 });
			}
		}
		await removerGiseMembro(db, remover_membro_id);
	}

	return json({ ok: true, assinatura_revogada: revogouAssinatura });
};

/** POST → finaliza seccional */
export const POST: RequestHandler = async ({ locals, params, platform }) => {
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

	const novoStatus = sec.status === 'retificada' ? 'preenchida_retificada' : 'preenchida';
	await atualizarGiseSeccional(db, secId, { status: novoStatus });

	const todasPreenchidas = await verificarGiseCompleta(db, giseId);
	if (todasPreenchidas) {
		await atualizarGiseEscala(db, giseId, { status: 'aguardando_assinatura' });
		return json({ ok: true, gise_status: 'aguardando_assinatura' });
	}

	return json({ ok: true, gise_status: 'em_preenchimento' });
};

export const DELETE: RequestHandler = async ({ locals, params, platform }) => {
	const u = locals.usuario;
	const giseId = parseInt(params.id);
	const secId = parseInt(params.sec_id);

	if (!u || !isAdminGeral(u)) {
		return json({ error: 'Somente administradores gerais podem excluir seccionais' }, { status: 403 });
	}

	const db = getDB(platform);

	const sec = await db
		.select({ id: giseSeccionais.id })
		.from(giseSeccionais)
		.where(and(eq(giseSeccionais.id, secId), eq(giseSeccionais.gise_id, giseId)))
		.get();
	if (!sec) return json({ error: 'Seccional não encontrada nesta escala' }, { status: 404 });

	await excluirGiseSeccional(db, secId);
	await db.delete(giseDocumentos).where(eq(giseDocumentos.gise_id, giseId));

	const seccionaisRestantes = await db
		.select({ id: giseSeccionais.id })
		.from(giseSeccionais)
		.where(eq(giseSeccionais.gise_id, giseId))
		.all();

	let novoStatus: 'em_preenchimento' | 'aguardando_assinatura' = 'em_preenchimento';
	if (seccionaisRestantes.length > 0) {
		const todasPreenchidas = await verificarGiseCompleta(db, giseId);
		if (todasPreenchidas) novoStatus = 'aguardando_assinatura';
	}

	await atualizarGiseEscala(db, giseId, { status: novoStatus });
	return json({ ok: true, gise_status: novoStatus });
};
