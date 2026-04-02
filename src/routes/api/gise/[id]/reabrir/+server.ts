/**
 * POST /api/gise/[id]/reabrir
 *
 * Reabre uma escala GISE assinada ou finalizada para edição.
 * Revoga a assinatura digital e reseta o status das seccionais.
 * Exclusivo do Administrador Geral.
 */

import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { getDB, buscarGiseEscala, reabrirGiseEscala } from '$lib/db';
import { isAdminGeral } from '$lib/auth';

export const POST = async ({ locals, params, platform }: RequestEvent) => {
	const u = locals.usuario;
	if (!isAdminGeral(u)) {
		return json({ error: 'Apenas o Administrador Geral pode reabrir escalas GISE' }, { status: 403 });
	}

	const id = parseInt(params.id!);
	if (isNaN(id)) return json({ error: 'ID inválido' }, { status: 400 });

	const db = getDB(platform);
	const gise = await buscarGiseEscala(db, id);
	if (!gise) return json({ error: 'Escala GISE não encontrada' }, { status: 404 });

	if (
		gise.status !== 'em_andamento' &&
		gise.status !== 'aguardando_relatorios' &&
		gise.status !== 'aguardando_assinatura_relat' &&
		gise.status !== 'pronta_para_finalizar' &&
		gise.status !== 'finalizada'
	) {
		return json({ error: 'Apenas escalas em andamento ou finalizadas podem ser reabertas' }, { status: 400 });
	}

	await reabrirGiseEscala(db, id);

	return json({ ok: true });
};
