/**
 * Helpers centralizados para API routes.
 *
 * Uso típico:
 *   import { requireAuth, requireAdmin, apiError, ErrorCode } from '$lib/server/api';
 *
 *   export const GET: RequestHandler = async ({ locals }) => {
 *     const usuario = requireAuth(locals);
 *     if (usuario instanceof Response) return usuario;
 *     // ... lógica do handler
 *   };
 */

import { json } from '@sveltejs/kit';
import type { z } from 'zod';
import type { UsuarioLogado } from '$lib/auth';
import { isAdminGeral } from '$lib/auth';
import { logger } from './logger';
import { mensagemDeErro } from '$lib/utils/erro';

// ---- ErrorCode tipado --------------------------------------------------
//
// Substitui a string livre `errorType?: string` por um enum fechado. O
// front-end pode discriminar fluxos (ex.: `validation` → realça campo;
// `csrf` → reloga; `rate_limit` → mostra contador) sem depender da
// mensagem em PT-BR (que pode mudar a qualquer momento).
//
// A regra é: adicionar valor novo SEMPRE que o front precise reagir
// diferente — nunca duplicar com strings ad-hoc.

export const ErrorCode = {
	/** Falha de validação de schema (Zod) — caller deve realçar o campo. */
	VALIDATION: 'validation',
	/** Sessão expirada / sem cookie — front deve redirecionar para /login. */
	AUTH_REQUIRED: 'auth_required',
	/** Autenticado mas sem permissão — exibir mensagem, não relogar. */
	FORBIDDEN: 'forbidden',
	/** Token CSRF ausente/inválido — reload p/ obter novo. */
	CSRF: 'csrf',
	/** Recurso não existe. */
	NOT_FOUND: 'not_found',
	/** Conflito de estado (ex.: já assinado). */
	CONFLICT: 'conflict',
	/** Janela de rate-limit ultrapassada — front pode esconder formulário. */
	RATE_LIMIT: 'rate_limit',
	/** Falha externa (e-mail, OCSP, etc.) — caller pode oferecer retry. */
	UPSTREAM: 'upstream',
	/** Erro inesperado (5xx) — caller mostra errorId. */
	INTERNAL: 'internal'
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/** Corpo serializado padronizado de erro da API. */
interface ApiErrorBody {
	error: string;
	status: number;
	errorType?: ErrorCode;
	/** Identificador único para correlação com Sentry / logs. Só em 5xx. */
	errorId?: string;
}

/**
 * Cria uma resposta JSON de erro padronizada para a API.
 *
 * Formato: `{ error, status, errorType?, errorId? }`. O `errorType` é
 * **fortemente tipado** (`ErrorCode`); novas categorias devem ser adicionadas
 * ao enum, não passadas como string livre.
 */
export function apiError(
	message: string,
	status: number = 500,
	errorType?: ErrorCode,
	extras?: { errorId?: string }
): Response {
	const body: ApiErrorBody = { error: message, status };
	if (errorType) body.errorType = errorType;
	if (extras?.errorId) body.errorId = extras.errorId;
	return json(body as unknown as Record<string, unknown>, { status });
}

// ---- Autenticação e autorização ----

/**
 * Retorna o usuário logado ou uma Response 401 se não autenticado.
 * Padrão de uso: `const u = requireAuth(locals); if (u instanceof Response) return u;`
 */
export function requireAuth(locals: App.Locals): UsuarioLogado | Response {
	if (!locals.usuario) {
		return apiError('Não autorizado', 401, ErrorCode.AUTH_REQUIRED);
	}
	return locals.usuario;
}

/**
 * Retorna o usuário logado se for admin geral, ou uma Response 403.
 */
export function requireAdmin(locals: App.Locals): UsuarioLogado | Response {
	const usuario = requireAuth(locals);
	if (usuario instanceof Response) return usuario;
	// Admin Geral = sessão de admin (tipo === 'admin'): bootstrap por env OU
	// policial promovido (linha vinculada em `administradores`, logado como admin).
	if (!isAdminGeral(usuario)) {
		return apiError('Acesso restrito a administradores', 403, ErrorCode.FORBIDDEN);
	}
	return usuario;
}

/**
 * Retorna o usuário logado se for Super Admin, ou uma Response 403.
 */
export function requireSuperAdmin(locals: App.Locals): UsuarioLogado | Response {
	const usuario = requireAuth(locals);
	if (usuario instanceof Response) return usuario;
	if (!usuario.isSuperAdmin) {
		return apiError('Acesso restrito ao Super Administrador', 403, ErrorCode.FORBIDDEN);
	}
	return usuario;
}

// ---- Respostas de erro padronizadas ----

/** Resposta 400 Bad Request — opcionalmente com ErrorCode (default VALIDATION). */
export function badRequest(mensagem: string, code: ErrorCode = ErrorCode.VALIDATION): Response {
	return apiError(mensagem, 400, code);
}

/** Resposta 401 Unauthorized */
export function unauthorized(mensagem = 'Não autorizado'): Response {
	return apiError(mensagem, 401, ErrorCode.AUTH_REQUIRED);
}

/** Resposta 403 Forbidden */
export function forbidden(mensagem = 'Acesso negado'): Response {
	return apiError(mensagem, 403, ErrorCode.FORBIDDEN);
}

/** Resposta 404 Not Found */
export function notFound(recurso = 'Recurso'): Response {
	return apiError(`${recurso} não encontrado`, 404, ErrorCode.NOT_FOUND);
}

/** Resposta 409 Conflict — mudança de estado bloqueada. */
export function conflict(mensagem: string): Response {
	return apiError(mensagem, 409, ErrorCode.CONFLICT);
}

/** Resposta 429 Too Many Requests. */
export function rateLimited(mensagem = 'Muitas requisições. Tente novamente em breve.'): Response {
	return apiError(mensagem, 429, ErrorCode.RATE_LIMIT);
}

/**
 * Lê e valida o body JSON de uma requisição contra um schema Zod.
 *
 * Em sucesso devolve `{ ok: true, data }`. Em falha devolve `{ ok: false, response }`
 * com uma `Response` 400 já formatada — o handler só precisa retorná-la.
 *
 * @example
 *   const v = await validateBody(request, prepararAssinaturaSchema);
 *   if (!v.ok) return v.response;
 *   const { signerName, latitude, longitude } = v.data;
 */
export async function validateBody<T extends z.ZodTypeAny>(
	request: Request,
	schema: T
): Promise<{ ok: true; data: z.infer<T> } | { ok: false; response: Response }> {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return { ok: false, response: badRequest('Body JSON inválido') };
	}
	const parsed = schema.safeParse(body);
	if (!parsed.success) {
		return {
			ok: false,
			response: badRequest(parsed.error.issues[0]?.message ?? 'Dados inválidos')
		};
	}
	return { ok: true, data: parsed.data };
}

/**
 * Resposta 500 Internal Server Error — registra o erro com errorId único
 * e devolve esse mesmo ID ao cliente. NÃO expõe detalhes técnicos.
 *
 * Use sempre que precisar retornar 500 — assim o usuário pode reportar
 * o errorId e o operador rastreia no log/Sentry imediatamente.
 */
export function serverError(contexto: string, err: unknown): Response {
	const errorId = crypto.randomUUID().slice(0, 8);
	logger.error(contexto, {
		errorId,
		error: mensagemDeErro(err),
		stack: err instanceof Error ? err.stack : undefined
	});
	return apiError(
		'Erro interno do servidor. Reporte o código de rastreamento abaixo.',
		500,
		ErrorCode.INTERNAL,
		{ errorId }
	);
}

// ---- Headers HTTP ----

/**
 * Gera um header Content-Disposition RFC 6266 compatível.
 * Usa filename* (UTF-8 percent-encoded) como valor principal e um fallback ASCII.
 *
 * Uso: `'Content-Disposition': contentDisposition('Escala 2024-01-15.pdf')`
 */
export function contentDisposition(filename: string): string {
	const ascii = filename.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '\\"');
	const encoded = encodeURIComponent(filename);
	return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
