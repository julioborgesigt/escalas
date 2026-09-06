import { json } from '@sveltejs/kit';
import { encerrarSessaoAtual } from '$lib/server/auth/encerrar-sessao';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	await encerrarSessaoAtual(event);
	return json({ success: true });
};
