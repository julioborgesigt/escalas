import { json } from '@sveltejs/kit';
import { getDB, auditar, contextoDeEvento } from '$lib/db';
import { excluirSessao } from '$lib/auth';
import { invalidarSessaoCache } from '$lib/server/auth/session-cache';
import { CSRF_COOKIE_NAME } from '$lib/server/auth/csrf';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	const { platform, cookies, locals } = event;
	const token = cookies.get('session_token');
	if (token) {
		const db = getDB(platform);
		await excluirSessao(db, token);
		// Revogação imediata no colo local — sem isto o cache edge (TTL 60s)
		// ainda aceitaria o token por até 1 minuto após o logout.
		await invalidarSessaoCache(token);
		cookies.delete('session_token', { path: '/' });

		// `locals.usuario` foi populado pelo hook de auth (logout não é rota pública).
		if (locals.usuario) {
			const { contexto, env } = contextoDeEvento(event);
			await auditar(
				db,
				{
					acao: 'logout',
					usuario: locals.usuario,
					entidade: locals.usuario.tipo,
					entidade_id: locals.usuario.id,
					detalhes: 'Logout',
					...contexto
				},
				{ env }
			);
		}
	}
	cookies.delete(CSRF_COOKIE_NAME, { path: '/' });
	return json({ success: true });
};
