/**
 * GET   /api/gise/[id]  → detalhe completo da escala GISE
 * PATCH /api/gise/[id]  → atualiza campos (horários, supervisores, datas) — Feature 1 e 5
 * DELETE /api/gise/[id] → exclui (Admin Geral) — Feature 5: permite excluir mesmo finalizada
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	getDB,
	buscarGiseDetalhado,
	atualizarGiseEscala,
	buscarGiseEscala
} from '$lib/db';
import { isAdminGeral } from '$lib/auth';
import { policiais, giseEscalas, giseDocumentos } from '$lib/server/schema';
import { eq } from 'drizzle-orm';

export const GET: RequestHandler = async ({ locals, params, platform }) => {
	const u = locals.usuario;
	if (!u) return json({ error: 'Não autorizado' }, { status: 401 });

	const id = parseInt(params.id);
	if (isNaN(id)) return json({ error: 'ID inválido' }, { status: 400 });

	const db = getDB(platform);
	const gise = await buscarGiseDetalhado(db, id);
	if (!gise) return json({ error: 'Escala GISE não encontrada' }, { status: 404 });

	return json(gise);
};

export const PATCH: RequestHandler = async ({ locals, params, request, platform }) => {
	const u = locals.usuario;
	if (!isAdminGeral(u)) {
		return json({ error: 'Apenas o Administrador Geral pode editar escalas GISE' }, { status: 403 });
	}

	const id = parseInt(params.id);
	if (isNaN(id)) return json({ error: 'ID inválido' }, { status: 400 });

	const db = getDB(platform);
	const gise = await buscarGiseEscala(db, id);
	if (!gise) return json({ error: 'GISE não encontrada' }, { status: 404 });

	const body = await request.json();

	const {
		data_inicio,
		data_fim,
		hora_entrada,
		hora_saida,
		hora_entrada_sabado,
		hora_saida_sabado,
		hora_entrada_domingo,
		hora_saida_domingo,
		supervisor_sabado_id,
		supervisor_domingo_id,
		status
	} = body as {
		data_inicio?: string;
		data_fim?: string;
		hora_entrada?: string;
		hora_saida?: string;
		hora_entrada_sabado?: string;
		hora_saida_sabado?: string;
		hora_entrada_domingo?: string;
		hora_saida_domingo?: string;
		supervisor_sabado_id?: number | null;
		supervisor_domingo_id?: number | null;
		status?: string;
	};

	// Validar supervisores: devem ser DPC
	for (const [campo, valor] of [
		['supervisor_sabado_id', supervisor_sabado_id],
		['supervisor_domingo_id', supervisor_domingo_id]
	] as const) {
		if (valor != null) {
			const p = await db.select({ cargo: policiais.cargo }).from(policiais).where(eq(policiais.id, valor)).get();
			if (!p) return json({ error: `Policial (${campo}) não encontrado` }, { status: 404 });
			if (p.cargo !== 'DPC') {
				return json({ error: 'Apenas policiais com cargo DPC podem ser Supervisores' }, { status: 400 });
			}
		}
	}

	const updateData: Record<string, unknown> = {};
	if (data_inicio !== undefined) updateData.data_inicio = data_inicio;
	if (data_fim !== undefined) updateData.data_fim = data_fim;
	if (hora_entrada !== undefined) updateData.hora_entrada = hora_entrada;
	if (hora_saida !== undefined) updateData.hora_saida = hora_saida;
	if (hora_entrada_sabado !== undefined) updateData.hora_entrada_sabado = hora_entrada_sabado;
	if (hora_saida_sabado !== undefined) updateData.hora_saida_sabado = hora_saida_sabado;
	if (hora_entrada_domingo !== undefined) updateData.hora_entrada_domingo = hora_entrada_domingo;
	if (hora_saida_domingo !== undefined) updateData.hora_saida_domingo = hora_saida_domingo;
	if (supervisor_sabado_id !== undefined) updateData.supervisor_sabado_id = supervisor_sabado_id;
	if (supervisor_domingo_id !== undefined) updateData.supervisor_domingo_id = supervisor_domingo_id;
	if (status !== undefined) updateData.status = status;

	// Feature 5: se estiver editando datas/horários de uma GISE assinada/finalizada, revogar assinatura
	const editandoTempoOuData =
		data_inicio !== undefined ||
		data_fim !== undefined ||
		hora_entrada !== undefined ||
		hora_saida !== undefined ||
		hora_entrada_sabado !== undefined ||
		hora_saida_sabado !== undefined ||
		hora_entrada_domingo !== undefined ||
		hora_saida_domingo !== undefined;

	if (editandoTempoOuData && (gise.status === 'assinada' || gise.status === 'finalizada')) {
		// Revogar assinatura digital
		await db.delete(giseDocumentos).where(eq(giseDocumentos.gise_id, id));
		// Se estava assinada ou finalizada, voltar para em_preenchimento
		updateData.status = 'em_preenchimento';
	}

	await atualizarGiseEscala(db, id, updateData as any);
	return json({ ok: true, assinatura_revogada: editandoTempoOuData && (gise.status === 'assinada' || gise.status === 'finalizada') });
};

export const DELETE: RequestHandler = async ({ locals, params, platform }) => {
	const u = locals.usuario;
	if (!isAdminGeral(u)) {
		return json({ error: 'Apenas o Administrador Geral pode excluir escalas GISE' }, { status: 403 });
	}

	const id = parseInt(params.id);
	if (isNaN(id)) return json({ error: 'ID inválido' }, { status: 400 });

	const db = getDB(platform);
	const gise = await buscarGiseEscala(db, id);
	if (!gise) return json({ error: 'Escala GISE não encontrada' }, { status: 404 });

	// Feature 5: Admin Geral pode excluir mesmo escalas finalizadas
	await db.delete(giseEscalas).where(eq(giseEscalas.id, id));
	return json({ ok: true });
};
