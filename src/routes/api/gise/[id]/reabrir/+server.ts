/**
 * POST /api/gise/[id]/reabrir
 *
 * Reabre uma escala GISE assinada ou finalizada para edição.
 * Revoga a assinatura digital e reseta o status das seccionais.
 * Exclusivo do Administrador Geral.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDB, buscarGiseEscala, reabrirGiseEscala, auditar, contextoDeEvento } from '$lib/db';
import { coletarAfetadosGise, invalidarPapelGiseMultiplos } from '$lib/server/gise-papel-cache';
import { giseIdParamSchema } from '$lib/schemas';
import { requireAdmin, badRequest, notFound } from '$lib/server/api';

export const POST: RequestHandler = async (event) => {
	const { locals, params, platform } = event;
	const u = requireAdmin(locals);
	if (u instanceof Response) return u;

	const parsed = giseIdParamSchema.safeParse(params);
	if (!parsed.success) return badRequest(parsed.error.issues[0].message);

	const { id } = parsed.data;

	const db = getDB(platform);
	const gise = await buscarGiseEscala(db, id);
	if (!gise) return notFound('Escala GISE');

	if (
		gise.status !== 'em_andamento' &&
		gise.status !== 'aguardando_relatorios' &&
		gise.status !== 'aguardando_assinatura_relat' &&
		gise.status !== 'pronta_para_finalizar' &&
		gise.status !== 'finalizada'
	) {
		return badRequest('Apenas escalas em andamento ou finalizadas podem ser reabertas');
	}

	// Cache invalidation: ao reabrir, supervisor + membros voltam a ter papel
	// ativo; coletamos antes da mudança para invalidar todos.
	const afetados = await coletarAfetadosGise(db, id);
	await reabrirGiseEscala(db, id);
	await invalidarPapelGiseMultiplos(afetados);

	const { contexto, env } = contextoDeEvento(event);
	await auditar(
		db,
		{
			acao: 'reabrir_gise',
			usuario: u,
			entidade: 'gise',
			entidade_id: id,
			alvo_tipo: 'gise',
			alvo_id: id,
			detalhes: `GISE ${id} reaberta (status anterior: ${gise.status})`,
			metadados: { status_anterior: gise.status, data_inicio: gise.data_inicio },
			...contexto
		},
		{ env }
	);

	return json({ ok: true });
};
