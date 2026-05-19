import type { Handle, HandleServerError } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { redirect } from '@sveltejs/kit';
import { captureException, setUser } from '@sentry/cloudflare';
import { validarSessao } from '$lib/auth';
import { getDB, temAceiteVigente } from '$lib/db';
import { VERSAO as TERMO_VERSAO, calcularHashTermo } from '$lib/server/termo/termo-vigente';
import { logger } from '$lib/server/logger';
import { requestStore, getRequestCtx } from '$lib/server/request-context';
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME, generateCsrfToken } from '$lib/server/csrf';
import { buildCSP } from '$lib/server/csp';

const ROTAS_PUBLICAS = new Set([
	'/login',
	'/api/auth/login',
	'/api/auth/verificar-2fa',
	'/api/auth/primeiro-acesso',
	'/api/auth/solicitar-redefinicao',
	'/api/auth/confirmar-redefinicao',
	'/redefinir-senha',
	'/validar',
	'/api/validar',
	'/api/health',
	'/api/webhook',
	'/termo'
]);

function isRotaPublica(pathname: string): boolean {
	for (const rota of ROTAS_PUBLICAS) {
		if (pathname.startsWith(rota)) return true;
	}
	return false;
}

/** Routes exempt from CSRF token verification (no session or read-only). */
const CSRF_EXEMPT_ROUTES = new Set(['/api/auth/login', '/api/health', '/api/webhook']);
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

/** 0. Request Context: injeta requestId no AsyncLocalStorage para correlação de logs */
const handleRequestContext: Handle = async ({ event, resolve }) => {
	const requestId = crypto.randomUUID().slice(0, 8);
	event.locals.requestId = requestId;
	const ctx = { requestId, path: event.url.pathname, userId: 'anon' };
	return requestStore.run(ctx, () => resolve(event));
};

/** 1. CSRF Layer: Double-submit cookie pattern verification */
const handleCsrf: Handle = async ({ event, resolve }) => {
	const { pathname } = event.url;

	let csrfToken = event.cookies.get(CSRF_COOKIE_NAME);
	if (!csrfToken) {
		csrfToken = generateCsrfToken();
		event.cookies.set(CSRF_COOKIE_NAME, csrfToken, {
			path: '/',
			httpOnly: false, // deve ser false para o padrão double-submit (JS precisa ler o token)
			secure: event.url.protocol === 'https:',
			// `lax` em vez de `strict`: garante que o cookie viaje em navegações
			// top-level cross-site (ex.: clique em link de redefinição de senha
			// vindo de e-mail). Como este cookie é apenas o "lado JS" do padrão
			// double-submit (o servidor compara com o header `x-csrf-token`
			// enviado por XHR mesma-origem), `lax` mantém a proteção CSRF: um
			// formulário cross-site não consegue ler o cookie nem montar o header.
			sameSite: 'lax',
			maxAge: 60 * 60 * 24 // 24 hours
		});
	}

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

	return resolve(event);
};

/** 2. Auth Layer: Session validation and user propagation */
const handleAuth: Handle = async ({ event, resolve }) => {
	const { pathname } = event.url;

	if (isRotaPublica(pathname)) {
		event.locals.usuario = null;
		return resolve(event);
	}

	const token = event.cookies.get('session_token');
	let usuario = null;

	try {
		const db = getDB(event.platform);
		usuario = await validarSessao(db, token);
	} catch (err) {
		logger.warn('[hooks] validarSessao falhou', { err: String(err) });
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

	// Propagar userId para o contexto de logs e Sentry
	const reqCtx = getRequestCtx();
	if (reqCtx) reqCtx.userId = String(usuario.id);
	setUser({ id: String(usuario.id), username: usuario.nome });

	// Fluxo de Primeiro Acesso
	if (usuario.primeiro_acesso && !pathname.startsWith('/alterar-senha') && !pathname.startsWith('/api/auth/')) {
		if (pathname.startsWith('/api/')) {
			return new Response(JSON.stringify({ error: 'Altere sua senha antes de continuar' }), {
				status: 403,
				headers: { 'Content-Type': 'application/json' }
			});
		}
		throw redirect(302, '/alterar-senha');
	}

	// Fluxo de aceite do Termo de Uso vigente.
	// Roda APÓS primeiro_acesso resolvido (senha definida + e-mail confirmado).
	// Rotas livres do bloqueio: a própria /aceitar-termo, /termo/[versao] (consulta
	// pública), /api/auth/logout (permitir sair) e a rota raiz pós-login.
	const rotasLivresTermo =
		pathname.startsWith('/aceitar-termo') ||
		pathname.startsWith('/termo/') ||
		pathname.startsWith('/api/termos/') ||
		pathname.startsWith('/api/auth/');
	if (!rotasLivresTermo) {
		try {
			const db = getDB(event.platform);
			const hash = await calcularHashTermo();
			const ok = await temAceiteVigente(db, usuario.tipo, usuario.id, TERMO_VERSAO, hash);
			if (!ok) {
				if (pathname.startsWith('/api/')) {
					return new Response(
						JSON.stringify({ error: 'Aceite o Termo de Uso vigente antes de continuar' }),
						{ status: 403, headers: { 'Content-Type': 'application/json' } }
					);
				}
				throw redirect(302, '/aceitar-termo');
			}
		} catch (err) {
			// `redirect` é uma exceção de controle de fluxo do SvelteKit — propaga.
			if (err && typeof err === 'object' && 'status' in err && 'location' in err) throw err;
			logger.warn('[hooks] verificação de termo falhou — permitindo seguir', {
				err: String(err)
			});
		}
	}

	event.locals.usuario = usuario;
	return resolve(event);
};

/** 3. Security Layer: Headers and CSP application */
const handleSecurity: Handle = async ({ event, resolve }) => {
	const response = await resolve(event);

	// Apply basic security headers
	for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
		response.headers.set(key, value);
	}

	// CSP por tipo de conteúdo:
	//  - HTML: gerenciada pelo SvelteKit via `kit.csp` em svelte.config.js.
	//    Não setamos manualmente para não sobrescrever os nonces injetados.
	//  - Não-HTML (JSON, downloads, etc.): default-src 'none' via `buildCSP`.
	const contentType = response.headers.get('content-type') || '';
	const isHTML = contentType.includes('text/html');
	const csp = buildCSP(isHTML, { isProduction: import.meta.env.PROD });
	if (csp !== null) {
		response.headers.set('Content-Security-Policy', csp);
	}

	// HSTS
	if (event.url.protocol === 'https:') {
		response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
	}

	// Default: respostas autenticadas NUNCA podem ser cacheadas pelo edge ou por
	// proxies intermediários. Sem isto, o Cloudflare poderia servir uma resposta
	// com `set-cookie: session_token` ou dados pessoais a outro usuário.
	// Rotas que querem cache (ex.: /validar/[hash]) já setam Cache-Control e
	// continuam funcionando — só preenchemos o default quando nada foi setado.
	if (event.locals.usuario && !response.headers.has('Cache-Control')) {
		response.headers.set('Cache-Control', 'private, no-store');
	}

	return response;
};

/** Main Export with sequence middleware */
export const handle = sequence(handleRequestContext, handleCsrf, handleAuth, handleSecurity);

/** Tratamento centralizado de erros inesperados */
export const handleError: HandleServerError = ({ error, event }) => {
	// Reutiliza o requestId já criado no handleRequestContext para correlacionar
	// os logs emitidos antes do erro com o errorId devolvido ao usuário.
	const errorId = event.locals.requestId ?? crypto.randomUUID().slice(0, 8);

	logger.error('Erro não tratado', {
		errorId,
		path: event.url.pathname,
		method: event.request.method,
		message: error instanceof Error ? error.message : String(error),
		...(import.meta.env.DEV && error instanceof Error && error.stack
			? { stack: error.stack }
			: {})
	});

	captureException(error, {
		tags: { errorId, path: event.url.pathname },
		extra: { method: event.request.method }
	});

	return {
		message: 'Ocorreu um erro interno. Tente novamente.',
		errorId
	};
};
