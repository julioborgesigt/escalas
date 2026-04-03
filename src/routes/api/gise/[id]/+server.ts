/**
 * GET   /api/gise/[id]  → detalhe completo da escala GISE
 * PATCH /api/gise/[id]  → atualiza campos (horários, supervisor, data)
 * DELETE /api/gise/[id] → exclui (Admin Geral)
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
		hora_entrada,
		hora_saida,
		supervisor_id,
		status
	} = body as {
		data_inicio?: string;
		hora_entrada?: string;
		hora_saida?: string;
		supervisor_id?: number | null;
		status?: string;
	};

	// Validar supervisor: deve ser DPC
	if (supervisor_id != null) {
		const p = await db.select({ cargo: policiais.cargo }).from(policiais).where(eq(policiais.id, supervisor_id)).get();
		if (!p) return json({ error: 'Policial não encontrado' }, { status: 404 });
		if (p.cargo !== 'DPC') {
			return json({ error: 'Apenas policiais com cargo DPC podem ser Supervisores' }, { status: 400 });
		}
	}

	const updateData: Record<string, unknown> = {};
	if (data_inicio !== undefined) updateData.data_inicio = data_inicio;
	if (hora_entrada !== undefined) updateData.hora_entrada = hora_entrada;
	if (hora_saida !== undefined) updateData.hora_saida = hora_saida;
	if (supervisor_id !== undefined) updateData.supervisor_id = supervisor_id;
	if (status !== undefined) updateData.status = status;

	// Transição automática: ao designar supervisor numa escala em_definicao_supervisor → em_preenchimento
	if (supervisor_id != null && gise.status === 'em_definicao_supervisor') {
		updateData.status = 'em_preenchimento';
	}

	const editandoTempoOuData = data_inicio !== undefined || hora_entrada !== undefined || hora_saida !== undefined;
	const editandoSupervisor = supervisor_id !== undefined && supervisor_id !== gise.supervisor_id;
	const deveResetarStatus = editandoTempoOuData || editandoSupervisor;

	if (deveResetarStatus && (
		gise.status === 'aguardando_assinatura' ||
		gise.status === 'em_andamento' ||
		gise.status === 'aguardando_relatorios' ||
		gise.status === 'aguardando_assinatura_relat' ||
		gise.status === 'pronta_para_finalizar' ||
		gise.status === 'finalizada'
	)) {
		await db.delete(giseDocumentos).where(eq(giseDocumentos.gise_id, id));
		updateData.status = 'em_preenchimento';
	}

	await atualizarGiseEscala(db, id, updateData as any);
	return json({ ok: true, assinatura_revogada: deveResetarStatus && updateData.status === 'em_preenchimento' });
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

	await db.delete(giseEscalas).where(eq(giseEscalas.id, id));
	return json({ ok: true });
};
