/**
 * PATCH  /api/gise/[id]/seccionais/[sec_id]
 *   → Admin Seccional: define unidade operacional, adiciona/remove membros das equipes
 *   → Admin Geral: todas as operações acima + alterar slots
 *   Feature 4: Se a seccional já estava 'preenchida', ao ser alterada o status vai para 'retificada'
 *              e a assinatura digital da GISE é revogada.
 *   Feature 8: Valida slots disponíveis e conflito de horário do policial.
 *
 * POST /api/gise/[id]/seccionais/[sec_id]
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
	excluirGiseEquipe,
	criarGiseEquipe,
	verificarSlotEquipe,
	verificarConflitoMembroGise
} from '$lib/db';
import { isAdminGeral, isAdminSeccional } from '$lib/auth';
import { giseSeccionais, giseEquipes, giseMembros, policiais, unidades, giseDocumentos } from '$lib/server/schema';
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

	// Admin Geral pode editar em qualquer status; Admin Seccional só em em_preenchimento, aguardando_assinatura ou retificando
	if (!isAdminGeral(u) && (gise.status === 'finalizada' || gise.status === 'assinada')) {
		return json({ error: 'Escala já está fechada para edição' }, { status: 400 });
	}

	const body = await request.json();
	const {
		unidade_operacional_id,
		supervisor_sabado_id,
		supervisor_domingo_id,
		equipes,
		adicionar_membro,
		remover_membro_id,
		adicionar_equipe
	} = body as {
		unidade_operacional_id?: number | null;
		supervisor_sabado_id?: number | null;
		supervisor_domingo_id?: number | null;
		equipes?: Array<{ id: number; slots_dpc: number; slots_oip: number }>;
		adicionar_membro?: { equipe_id: number; policial_id: number; dia?: 'sabado' | 'domingo' | 'ambos' };
		remover_membro_id?: number;
		adicionar_equipe?: { tipo: 'operacional' | 'seint'; slots_dpc: number; slots_oip: number };
	};

	// Feature 4: Detectar se esta seccional já estava 'preenchida' e está sendo alterada
	const seccionalJaPreenchida = sec.status === 'preenchida' || sec.status === 'retificada';
	let revogouAssinatura = false;

	if (seccionalJaPreenchida && isAdminSeccional(u)) {
		// Marcar seccional como retificada
		await atualizarGiseSeccional(db, secId, { status: 'retificada' });

		// Revogar assinatura digital da GISE se existir
		const docExistente = await db
			.select({ id: giseDocumentos.id })
			.from(giseDocumentos)
			.where(eq(giseDocumentos.gise_id, giseId))
			.get();

		if (docExistente) {
			await db.delete(giseDocumentos).where(eq(giseDocumentos.gise_id, giseId));
			revogouAssinatura = true;
		}

		// Voltar GISE para em_preenchimento se estava aguardando_assinatura ou assinada
		if (gise.status === 'aguardando_assinatura' || gise.status === 'assinada') {
			await atualizarGiseEscala(db, giseId, { status: 'em_preenchimento' });
		}
	}

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

		// Feature 8: Verificar slots disponíveis
		const slotCheck = await verificarSlotEquipe(db, equipe_id, policial_id, dia);
		if (!slotCheck.ok) {
			return json({ error: slotCheck.motivo }, { status: 400 });
		}

		// Feature 8: Verificar conflito de escalamento do policial na mesma GISE
		const conflitoCheck = await verificarConflitoMembroGise(db, giseId, policial_id, dia);
		if (!conflitoCheck.ok) {
			return json({ error: conflitoCheck.motivo }, { status: 400 });
		}

		await adicionarGiseMembro(db, equipe_id, policial_id, dia);
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
		// Verificar que o membro pertence a uma equipe desta seccional
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

/** POST /api/gise/[id]/seccionais/[sec_id] → finaliza seccional */
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

	// Verificar se todas as seccionais estão preenchidas (pendente ou retificada = não preenchida)
	const todasPreenchidas = await verificarGiseCompleta(db, giseId);
	if (todasPreenchidas) {
		await atualizarGiseEscala(db, giseId, { status: 'aguardando_assinatura' });
		return json({ ok: true, gise_status: 'aguardando_assinatura' });
	}

	return json({ ok: true, gise_status: 'em_preenchimento' });
};
