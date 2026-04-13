/**
 * Helpers centralizados para API routes.
 *
 * Uso típico:
 *   import { requireAuth, requireAdmin, apiError } from '$lib/server/api';
 *
 *   export const GET: RequestHandler = async ({ locals }) => {
 *     const usuario = requireAuth(locals);
 *     if (usuario instanceof Response) return usuario;
 *     // ... lógica do handler
 *   };
 */

import { json } from '@sveltejs/kit';
import type { UsuarioLogado } from '$lib/auth';

// ---- Autenticação e autorização ----

/**
 * Retorna o usuário logado ou uma Response 401 se não autenticado.
 * Padrão de uso: `const u = requireAuth(locals); if (u instanceof Response) return u;`
 */
export function requireAuth(locals: App.Locals): UsuarioLogado | Response {
	if (!locals.usuario) {
		return json({ error: 'Não autorizado' }, { status: 401 });
	}
	return locals.usuario;
}

/**
 * Retorna o usuário logado se for admin geral, ou uma Response 403.
 */
export function requireAdmin(locals: App.Locals): UsuarioLogado | Response {
	const usuario = requireAuth(locals);
	if (usuario instanceof Response) return usuario;
	if (usuario.tipo !== 'admin') {
		return json({ error: 'Acesso restrito a administradores' }, { status: 403 });
	}
	return usuario;
}

/**
 * Retorna o usuário logado se for admin geral ou admin seccional/unidade, ou 403.
 */
export function requireAnyAdmin(locals: App.Locals): UsuarioLogado | Response {
	const usuario = requireAuth(locals);
	if (usuario instanceof Response) return usuario;
	if (usuario.tipo !== 'admin' && !usuario.papel) {
		return json({ error: 'Acesso negado' }, { status: 403 });
	}
	return usuario;
}

// ---- Respostas de erro padronizadas ----

/** Resposta 400 Bad Request */
export function badRequest(mensagem: string): Response {
	return json({ error: mensagem }, { status: 400 });
}

/** Resposta 401 Unauthorized */
export function unauthorized(mensagem = 'Não autorizado'): Response {
	return json({ error: mensagem }, { status: 401 });
}

/** Resposta 403 Forbidden */
export function forbidden(mensagem = 'Acesso negado'): Response {
	return json({ error: mensagem }, { status: 403 });
}

/** Resposta 404 Not Found */
export function notFound(recurso = 'Recurso'): Response {
	return json({ error: `${recurso} não encontrado` }, { status: 404 });
}

/** Resposta 500 Internal Server Error — não expõe detalhes ao cliente */
export function serverError(contexto: string, err: unknown): Response {
	console.error(`[${contexto}]`, err);
	return json({ error: 'Erro interno do servidor' }, { status: 500 });
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

// ---- Validação ----

/**
 * Valida dados com um schema Zod. Retorna os dados validados ou uma Response 400.
 * Padrão de uso: `const data = validate(body, schema); if (data instanceof Response) return data;`
 */
export function validate<T>(
	data: unknown,
	schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false; error: { issues: { message: string }[] } } }
): T | Response {
	const result = schema.safeParse(data);
	if (!result.success) {
		return json({ error: result.error.issues[0].message }, { status: 400 });
	}
	return result.data;
}
