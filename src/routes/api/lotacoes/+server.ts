import { json } from '@sveltejs/kit';
import { getDB, listarLotacoes } from '$lib/db';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ platform }) => {
	const db = getDB(platform);
	const lotacoes = await listarLotacoes(db);
	return json(lotacoes);
};
