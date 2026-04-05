import type { Handle, HandleServerError } from '@sveltejs/kit';
import { redirect } from '@sveltejs/kit';
import { captureException, setUser } from '@sentry/cloudflare';
import { validarSessao } from '$lib/auth';
import { getDB } from '$lib/db';
import { logger } from '$lib/server/logger';
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME, generateCsrfToken } from '$lib/server/csrf';

const ROTAS_PUBLICAS = new Set(['/login', '/api/auth/', '/validar', '/api/validar', '/api/health']);

function isRotaPublica(pathname: string): boolean {
	for (const rota of ROTAS_PUBLICAS) {
		if (pathname.startsWith(rota)) return true;
	}
	return false;
}

/** Routes exempt from CSRF token verification (no session or read-only). */
const CSRF_EXEMPT_ROUTES = new Set(['/api/auth/login', '/api/health']);

const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function isCsrfExempt(pathname: string): boolean {
	for (const rota of CSRF_EXEMPT_ROUTES) {
		if (pathname.startsWith(rota)) return true;
	}
	return false;
}

// Security headers aplicados em todas as respostas
const SECURITY_HEADERS: Record<string, string> = {
	'X-Frame-Options': 'DENY',
	'X-Content-Type-Options': 'nosniff',
	'Referrer-Policy': 'strict-origin-when-cross-origin',
	'Permissions-Policy': 'camera=(self), microphone=(), geolocation=(self)',
	'X-XSS-Protection': '1; mode=block'
};

export const handle: Handle = async ({ event, resolve }) => {
	const { pathname } = event.url;

	// --- CSRF double-submit cookie ---
	// Ensure every response carries a CSRF cookie (httpOnly=false so JS can read it).
	let csrfToken = event.cookies.get(CSRF_COOKIE_NAME);
	if (!csrfToken) {
		csrfToken = generateCsrfToken();
		event.cookies.set(CSRF_COOKIE_NAME, csrfToken, {
			path: '/',
			httpOnly: false,
			secure: event.url.protocol === 'https:',
			sameSite: 'lax',
			maxAge: 60 * 60 * 24 // 24 hours
		});
	}

	// For state-changing requests to /api/*, verify CSRF header matches cookie.
	if (
		pathname.startsWith('/api/') &&
		STATE_CHANGING_METHODS.has(event.request.method) &&
		!isCsrfExempt(pathname)
	) {
		const headerToken = event.request.headers.get(CSRF_HEADER_NAME);
		if (!headerToken || headerToken !== csrfToken) {
			return new Response(JSON.stringify({ error: 'Token CSRF inválido ou ausente' }), {
				status: 403,
				headers: { 'Content-Type': 'application/json' }
			});
		}
	}

	// Rotas públicas não precisam de autenticação
	if (isRotaPublica(pathname)) {
		event.locals.usuario = null;
		const response = await resolve(event);
		applySecurityHeaders(response, event.url);
		return response;
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

	// Adicionar contexto do usuário ao Sentry
	setUser({ id: String(usuario.id), username: usuario.nome });

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
	const response = await resolve(event);
	applySecurityHeaders(response, event.url);
	return response;
};

function applySecurityHeaders(response: Response, url: URL): void {
	for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
		response.headers.set(key, value);
	}
	// HSTS apenas em HTTPS (produção)
	if (url.protocol === 'https:') {
		response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
	}
}

/** Tratamento centralizado de erros inesperados */
export const handleError: HandleServerError = ({ error, event }) => {
	const errorId = crypto.randomUUID().slice(0, 8);

	logger.error('Erro não tratado', {
		errorId,
		path: event.url.pathname,
		method: event.request.method,
		message: error instanceof Error ? error.message : String(error),
		stack: error instanceof Error ? error.stack : undefined
	});

	// Reportar ao Sentry
	captureException(error, {
		tags: { errorId, path: event.url.pathname },
		extra: { method: event.request.method }
	});

	return {
		message: 'Ocorreu um erro interno. Tente novamente.',
		errorId
	};
};
