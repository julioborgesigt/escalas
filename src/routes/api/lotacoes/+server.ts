import { json } from '@sveltejs/kit';
import { getDB, listarLotacoes } from '$lib/db';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ platform, locals }) => {
	const db = getDB(platform);

	// Policial só vê sua própria lotação
	if (locals.usuario?.tipo === 'policial') {
		return json([locals.usuario.lotacao]);
	}

	const lotacoes = await listarLotacoes(db);
	return json(lotacoes);
};
