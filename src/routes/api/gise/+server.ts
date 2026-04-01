/**
 * GET  /api/gise  → lista escalas GISE
 * POST /api/gise  → cria escalas GISE para um intervalo de datas (uma por dia)
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDB, listarGiseEscalas, criarGiseEscala, upsertGiseSeccional } from '$lib/db';
import { isAdminGeral } from '$lib/auth';
import { eq } from 'drizzle-orm';
import { unidades } from '$lib/server/schema';

export const GET: RequestHandler = async ({ locals, platform }) => {
	const u = locals.usuario;
	if (!u) return json({ error: 'Não autorizado' }, { status: 401 });

	const db = getDB(platform);
	try {
		const escalas = await listarGiseEscalas(db);
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
		seccional_ids
	} = body as {
		data_inicio: string;
		data_fim: string;
		hora_entrada?: string;
		hora_saida?: string;
		seccional_ids?: number[];
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

		const ids: number[] = [];
		for (const data of datas) {
			const novoId = await criarGiseEscala(db, data, hora_entrada, hora_saida);
			for (const sid of seccionalIdsFinal) {
				await upsertGiseSeccional(db, novoId, sid);
			}
			ids.push(novoId);
		}

		return json({ ids, count: ids.length }, { status: 201 });
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		console.error('[POST /api/gise]', msg);
		return json({ error: msg }, { status: 500 });
	}
};
