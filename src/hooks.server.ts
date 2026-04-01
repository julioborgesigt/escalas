import type { Handle } from '@sveltejs/kit';
import { redirect } from '@sveltejs/kit';
import { validarSessao } from '$lib/auth';
import { getDB } from '$lib/db';

const ROTAS_PUBLICAS = ['/login', '/api/auth/login', '/validar', '/api/validar'];

export const handle: Handle = async ({ event, resolve }) => {
	const { pathname } = event.url;

	// Rotas públicas não precisam de autenticação
	if (ROTAS_PUBLICAS.some(r => pathname.startsWith(r))) {
		event.locals.usuario = null;
		return resolve(event);
	}

	// Validar sessão
	const token = event.cookies.get('session_token');
	let usuario = null;

	try {
		const db = getDB(event.platform);
		usuario = await validarSessao(db, token);
	} catch {
		// DB não disponível (dev sem D1)
	}

	if (!usuario) {
		if (pathname.startsWith('/api/')) {
			return new Response(JSON.stringify({ error: 'Não autorizado' }), {
				status: 401,
				headers: { 'Content-Type': 'application/json' }
			});
		}
		throw redirect(302, '/login');
	}

	// Primeiro acesso: forçar troca de senha
	if (usuario.primeiro_acesso && !pathname.startsWith('/alterar-senha') && !pathname.startsWith('/api/auth/')) {
		if (pathname.startsWith('/api/')) {
			return new Response(JSON.stringify({ error: 'Altere sua senha antes de continuar' }), {
				status: 403,
				headers: { 'Content-Type': 'application/json' }
			});
		}
		throw redirect(302, '/alterar-senha');
	}

	event.locals.usuario = usuario;
	return resolve(event);
};
