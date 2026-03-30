/**
 * POST /api/gise/[id]/finalizar
 *
 * Marca a escala GISE atual como "finalizada" e clona a próxima.
 * Exclusivo do Administrador Geral.
 * Estado 1 do fluxo de automação.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	getDB,
	buscarGiseEscala,
	atualizarGiseEscala,
	clonarGiseParaProximoFDS,
	verificarGiseCompleta
} from '$lib/db';
import { isAdminGeral } from '$lib/auth';

export const POST: RequestHandler = async ({ locals, params, platform, request }) => {
	const u = locals.usuario;
	if (!isAdminGeral(u)) {
		return json({ error: 'Apenas o Administrador Geral pode finalizar escalas GISE' }, { status: 403 });
	}

	const id = parseInt(params.id);
	if (isNaN(id)) return json({ error: 'ID inválido' }, { status: 400 });

	const db = getDB(platform);
	const gise = await buscarGiseEscala(db, id);
	if (!gise) return json({ error: 'Escala GISE não encontrada' }, { status: 404 });

	if (gise.status === 'finalizada') {
		return json({ error: 'Escala já finalizada' }, { status: 400 });
	}

	if (gise.status !== 'assinada') {
		return json({
			error: 'A escala deve estar assinada pelo Supervisor antes de ser finalizada'
		}, { status: 400 });
	}

	// Marcar como finalizada
	await atualizarGiseEscala(db, id, { status: 'finalizada' });

	// Obter o modo de criação da próxima escala (clonada ou completa)
	const body = await request.json().catch(() => ({}));
	const modo = (body.modo === 'completa') ? 'completa' : 'clonada';

	// Clonar para próximo FDS (sem supervisores, sem membros)
	const novoId = await clonarGiseParaProximoFDS(db, id, modo);

	return json({ ok: true, nova_gise_id: novoId });
};
