/**
 * POST /api/gise/[id]/finalizar
 *
 * Marca a escala GISE atual como "finalizada" e clona a próxima.
 * Exclusivo do Administrador Geral.
 * Estado 1 do fluxo de automação.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDB, buscarGiseEscala, atualizarGiseEscala, auditar, contextoDeEvento } from '$lib/db';
import { coletarAfetadosGise, invalidarPapelGiseMultiplos } from '$lib/server/gise-papel-cache';
import { agendarSyncBaseEquipeAposFinalizar } from '$lib/server/gise-base-equipe-sync';
import { giseIdParamSchema } from '$lib/schemas';
import { requireAdmin, badRequest, notFound, conflict } from '$lib/server/api';

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

	if (gise.status === 'finalizada') return conflict('Escala já finalizada');

	if (gise.status !== 'pronta_para_finalizar' && gise.status !== 'em_andamento') {
		return badRequest(
			'A escala precisa estar com todos os relatórios de extra assinados antes de ser finalizada'
		);
	}

	// Cache invalidation: supervisor + membros perdem papel ativo após finalizar.
	const afetados = await coletarAfetadosGise(db, id);
	await atualizarGiseEscala(db, id, { status: 'finalizada' });
	await invalidarPapelGiseMultiplos(afetados);

	agendarSyncBaseEquipeAposFinalizar(platform, db, id);

	const { contexto, env } = contextoDeEvento(event);
	await auditar(
		db,
		{
			acao: 'finalizar_gise',
			usuario: u,
			entidade: 'gise',
			entidade_id: id,
			alvo_tipo: 'gise',
			alvo_id: id,
			detalhes: `GISE ${id} finalizada (status anterior: ${gise.status})`,
			metadados: { status_anterior: gise.status, data_inicio: gise.data_inicio },
			...contexto
		},
		{ env }
	);

	return json({ ok: true });
};
