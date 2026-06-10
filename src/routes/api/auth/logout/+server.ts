import { json } from '@sveltejs/kit';
import { getDB } from '$lib/db';
import { excluirSessao } from '$lib/auth';
import { invalidarSessaoCache } from '$lib/server/session-cache';
import { CSRF_COOKIE_NAME } from '$lib/server/csrf';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ platform, cookies }) => {
	const token = cookies.get('session_token');
	if (token) {
		const db = getDB(platform);
		await excluirSessao(db, token);
		// Revogação imediata no colo local — sem isto o cache edge (TTL 60s)
		// ainda aceitaria o token por até 1 minuto após o logout.
		await invalidarSessaoCache(token);
		cookies.delete('session_token', { path: '/' });
	}
	cookies.delete(CSRF_COOKIE_NAME, { path: '/' });
	return json({ success: true });
};
