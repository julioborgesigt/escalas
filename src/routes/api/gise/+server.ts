/**
 * GET  /api/gise  → lista escalas GISE (Admin Geral, Admin Seccional, Supervisor)
 * POST /api/gise  → cria nova escala GISE manualmente (Admin Geral)
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDB, listarGiseEscalas, criarGiseEscala, upsertGiseSeccional } from '$lib/db';
import { isAdminGeral, isAdminSeccional } from '$lib/auth';
import { listarUnidades } from '$lib/db';
import { eq } from 'drizzle-orm';
import { unidades } from '$lib/server/schema';

export const GET: RequestHandler = async ({ locals, platform }) => {
	const u = locals.usuario;
	if (!u) return json({ error: 'Não autorizado' }, { status: 401 });

	const db = getDB(platform);
	const escalas = await listarGiseEscalas(db);
	return json(escalas);
};

export const POST: RequestHandler = async ({ locals, request, platform }) => {
	const u = locals.usuario;
	if (!isAdminGeral(u)) {
		return json({ error: 'Apenas o Administrador Geral pode criar escalas GISE' }, { status: 403 });
	}

	const db = getDB(platform);
	const body = await request.json();
	const { data_inicio, data_fim, hora_entrada = '08', hora_saida = '16', seccional_ids } = body as {
		data_inicio: string;
		data_fim: string;
		hora_entrada?: string;
		hora_saida?: string;
		seccional_ids?: number[];
	};

	if (!data_inicio || !data_fim) {
		return json({ error: 'data_inicio e data_fim são obrigatórios' }, { status: 400 });
	}

	const novoId = await criarGiseEscala(db, data_inicio, data_fim, hora_entrada, hora_saida);

	// Adicionar seccionais informadas (ou todas as seccionais cadastradas)
	if (seccional_ids && seccional_ids.length > 0) {
		for (const sid of seccional_ids) {
			await upsertGiseSeccional(db, novoId, sid);
		}
	} else {
		// Adicionar todas as seccionais
		const todasSeccionais = await db
			.select({ id: unidades.id })
			.from(unidades)
			.where(eq(unidades.tipo, 'seccional'));
		for (const sec of todasSeccionais) {
			await upsertGiseSeccional(db, novoId, sec.id);
		}
	}

	return json({ id: novoId }, { status: 201 });
};
