/**
 * GET  /api/gise  → lista escalas GISE
 * POST /api/gise  → cria escalas GISE para um intervalo de datas (uma por dia)
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDB, listarGiseEscalas, criarGiseEscala, upsertGiseSeccional, clonarGiseParaData, isSupervisorGiseAtiva } from '$lib/db';
import { isAdminGeral, isAdminSeccional } from '$lib/auth';
import { eq } from 'drizzle-orm';
import { unidades } from '$lib/server/schema';

export const GET: RequestHandler = async ({ locals, platform }) => {
	const u = locals.usuario;
	if (!u) return json({ error: 'Não autorizado' }, { status: 401 });

	const db = getDB(platform);
	try {
		const isGeral = isAdminGeral(u);
		const isSeccional = isAdminSeccional(u);
		const supervisorId = (!isGeral && !isSeccional) ? u.id : undefined;
		const escalas = await listarGiseEscalas(db, supervisorId);
		return json(escalas);
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		console.error('[GET /api/gise]', msg);
		return json({ error: msg }, { status: 500 });
	}
};

export const POST: RequestHandler = async ({ locals, request, platform }) => {
	const u = locals.usuario;
	if (!isAdminGeral(u)) {
		return json({ error: 'Apenas o Administrador Geral pode criar escalas GISE' }, { status: 403 });
	}

	const db = getDB(platform);
	const body = await request.json();
	const {
		data_inicio,
		data_fim,
		hora_entrada = '08:00',
		hora_saida = '16:00',
		seccional_ids,
		modo = 'completa',
		clonar_de
	} = body as {
		data_inicio: string;
		data_fim: string;
		hora_entrada?: string;
		hora_saida?: string;
		seccional_ids?: number[];
		modo?: 'completa' | 'clonada';
		clonar_de?: number;
	};

	if (!data_inicio) {
		return json({ error: 'data_inicio é obrigatório' }, { status: 400 });
	}

	// Gerar array de datas do intervalo (inclusivo)
	const fim = data_fim || data_inicio;
	const datas: string[] = [];
	const cursor = new Date(data_inicio + 'T00:00:00Z');
	const dataFimObj = new Date(fim + 'T00:00:00Z');
	while (cursor <= dataFimObj) {
		datas.push(cursor.toISOString().slice(0, 10));
		cursor.setUTCDate(cursor.getUTCDate() + 1);
	}

	try {
		const ids: number[] = [];

		if (modo === 'clonada' && clonar_de) {
			for (const data of datas) {
				const novoId = await clonarGiseParaData(db, clonar_de, data, 'clonada', hora_entrada, hora_saida);
				ids.push(novoId);
			}
		} else {
			// Buscar seccionais que serão adicionadas
			let seccionalIdsFinal: number[] = [];
			if (seccional_ids && seccional_ids.length > 0) {
				seccionalIdsFinal = seccional_ids;
			} else {
				const todasSeccionais = await db
					.select({ id: unidades.id })
					.from(unidades)
					.where(eq(unidades.tipo, 'seccional'));
				seccionalIdsFinal = todasSeccionais.map(s => s.id);
			}

			for (const data of datas) {
				const novoId = await criarGiseEscala(db, data, hora_entrada, hora_saida, 'em_definicao_supervisor');
				// Upserts em paralelo para todas as seccionais desta data
				await Promise.all(seccionalIdsFinal.map(sid => upsertGiseSeccional(db, novoId, sid)));
				ids.push(novoId);
			}
		}

		return json({ ids, count: ids.length }, { status: 201 });
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		console.error('[POST /api/gise]', msg);
		return json({ error: msg }, { status: 500 });
	}
};
