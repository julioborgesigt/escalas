/**
 * /api/gise/[id]/seccionais
 *
 * GET: Retorna seccionais que ainda NÃO estão nesta escala GISE.
 * POST: Adiciona uma nova seccional à escala GISE.
 */

import { json } from '@sveltejs/kit';
import { getDB, upsertGiseSeccional, atualizarGiseEscala } from '$lib/db';
import { isAdminGeral } from '$lib/auth';
import { unidades, giseSeccionais, giseDocumentos } from '$lib/server/schema';
import { eq } from 'drizzle-orm';

export const GET = async ({ locals, params, platform }: any) => {
	const u = locals.usuario;
	if (!u || !isAdminGeral(u)) {
		return json({ error: 'Somente administradores gerais podem gerenciar seccionais' }, { status: 403 });
	}

	const id = parseInt(params.id);
	if (isNaN(id)) return json({ error: 'ID inválido' }, { status: 400 });
	const db = getDB(platform);

	// Seccionais já na escala
	const seccionaisNaEscala = await db
		.select({ seccional_id: giseSeccionais.seccional_id })
		.from(giseSeccionais)
		.where(eq(giseSeccionais.gise_id, id))
		.all();

	const idsPreenchidos = seccionaisNaEscala.map((s) => s.seccional_id);

	// Buscar todas as seccionais que não estão na escala
	const todas = await db.select().from(unidades).where(eq(unidades.tipo, 'seccional')).all();
	const disponiveis = todas.filter(u => !idsPreenchidos.includes(u.id));

	return json(disponiveis);
};

export const POST = async ({ locals, params, request, platform }: any) => {
	const u = locals.usuario;
	if (!u || !isAdminGeral(u)) {
		return json({ error: 'Não autorizado' }, { status: 403 });
	}

	const id = parseInt(params.id);
	if (isNaN(id)) return json({ error: 'ID inválido' }, { status: 400 });
	const { seccionalId } = await request.json();

	if (!seccionalId) return json({ error: 'ID da seccional é obrigatório' }, { status: 400 });

	const db = getDB(platform);

	await upsertGiseSeccional(db, id, seccionalId);

	// Ao adicionar seccional, a escala volta para em_preenchimento e perde assinaturas
	await db.delete(giseDocumentos).where(eq(giseDocumentos.gise_id, id));
	await atualizarGiseEscala(db, id, { status: 'em_preenchimento' });

	return json({ ok: true });
};
