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
	atualizarGiseEscala
} from '$lib/db';
import { isAdminGeral } from '$lib/auth';
import { giseIdParamSchema } from '$lib/schemas';

export const POST: RequestHandler = async ({ locals, params, platform }) => {
	const u = locals.usuario;
	if (!isAdminGeral(u)) {
		return json({ error: 'Apenas o Administrador Geral pode finalizar escalas GISE' }, { status: 403 });
	}

	const parsed = giseIdParamSchema.safeParse(params);
	if (!parsed.success) {
		return json({ error: parsed.error.errors[0].message }, { status: 400 });
	}
	const { id } = parsed.data;

	const db = getDB(platform);
	const gise = await buscarGiseEscala(db, id);
	if (!gise) return json({ error: 'Escala GISE não encontrada' }, { status: 404 });

	if (gise.status === 'finalizada') {
		return json({ error: 'Escala já finalizada' }, { status: 400 });
	}

	if (gise.status !== 'pronta_para_finalizar' && gise.status !== 'em_andamento') {
		return json({
			error: 'A escala precisa estar com todos os relatórios de extra assinados antes de ser finalizada'
		}, { status: 400 });
	}

	// Marcar como finalizada
	await atualizarGiseEscala(db, id, { status: 'finalizada' });

	return json({ ok: true });
};
