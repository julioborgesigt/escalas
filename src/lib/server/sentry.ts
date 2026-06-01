/**
 * Helpers de Sentry: inicialização via `wrapRequestHandler` (Cloudflare Pages /
 * Workers) e `beforeSend` que sanitiza PII de URLs e tags.
 *
 * Inicialização: o `wrapRequestHandler` do `@sentry/cloudflare` chama
 * `Sentry.init` por request (idempotente — usa AsyncLocalStorage por isolate).
 * Sem isto, `captureException` é silenciosamente no-op, escondendo todos os
 * 5xx em produção.
 *
 * Configuração via env (definidas em `src/app.d.ts`):
 *   - SENTRY_DSN              (obrigatório; sem ele o handler é bypass)
 *   - SENTRY_ENVIRONMENT      (production | staging | dev — default 'production')
 *   - SENTRY_TRACES_SAMPLE_RATE (string parseada como float; default 0.1)
 */

import { wrapRequestHandler } from '@sentry/cloudflare';
import type { ErrorEvent as SentryErrorEvent, EventHint } from '@sentry/cloudflare';

/** Mascara IDs numéricos em paths para evitar cardinalidade alta no Sentry. */
function maskNumericIds(path: string): string {
	// /api/policiais/12345 → /api/policiais/:id
	// /escalas/42/foo → /escalas/:id/foo
	return path.replace(/\/\d+(?=\/|$|\?)/g, '/:id');
}

/**
 * `beforeSend` callback: roda em cada evento antes do envio ao Sentry.
 * Remove/mascara PII e parâmetros sensíveis.
 */
export function sentryBeforeSend(
	event: SentryErrorEvent,
	_hint: EventHint
): SentryErrorEvent | null {
	// 1. Mascarar IDs em URL e transação
	if (event.request?.url) {
		try {
			const url = new URL(event.request.url);
			url.pathname = maskNumericIds(url.pathname);
			// Strip query string inteira — pode conter tokens, codigos, etc.
			url.search = '';
			event.request.url = url.toString();
		} catch {
			// URL malformada — descarta
		}
	}
	if (event.transaction) {
		event.transaction = maskNumericIds(event.transaction);
	}
	if (event.tags?.path) {
		event.tags.path = maskNumericIds(String(event.tags.path));
	}

	// 2. Remover headers sensíveis (cookies, autorização, csrf)
	if (event.request?.headers) {
		const safeHeaders: Record<string, string> = {};
		const headers = event.request.headers as Record<string, string>;
		const denylist = new Set([
			'cookie',
			'set-cookie',
			'authorization',
			'proxy-authorization',
			'x-csrf-token',
			'x-reset-token',
			'x-confirm-reset',
			'x-hub-signature-256'
		]);
		for (const [k, v] of Object.entries(headers)) {
			if (!denylist.has(k.toLowerCase())) safeHeaders[k] = v;
		}
		event.request.headers = safeHeaders;
	}

	// 3. Strip body de request (pode conter senha, código 2FA, CPF, etc.)
	if (event.request?.data) {
		event.request.data = '[REDACTED]';
	}

	// 4. Strip variáveis locais de stack frames (podem conter senhas)
	if (event.exception?.values) {
		for (const ex of event.exception.values) {
			if (ex.stacktrace?.frames) {
				for (const frame of ex.stacktrace.frames) {
					if (frame.vars) frame.vars = {};
				}
			}
		}
	}

	return event;
}

/**
 * Envolve uma request em instrumentação Sentry. Se `SENTRY_DSN` não estiver
 * configurada (dev/local), executa o handler diretamente sem inicializar.
 */
export async function withSentryRequest<T extends Response>(
	platform: App.Platform | undefined,
	request: Request,
	handler: () => Promise<T> | T
): Promise<T> {
	const env = platform?.env as Env | undefined;
	const ctx = platform?.ctx;
	const dsn = env?.SENTRY_DSN;

	if (!dsn || !ctx) {
		return handler();
	}

	const sampleRate = env?.SENTRY_TRACES_SAMPLE_RATE
		? Number.parseFloat(env.SENTRY_TRACES_SAMPLE_RATE)
		: 0.1;

	return (await wrapRequestHandler(
		{
			options: {
				dsn,
				environment: env?.SENTRY_ENVIRONMENT ?? 'production',
				tracesSampleRate: Number.isFinite(sampleRate) ? sampleRate : 0.1,
				sendDefaultPii: false,
				beforeSend: sentryBeforeSend
			},
			// Cast: Cloudflare's Request type difere do DOM Request, mas
			// `wrapRequestHandler` aceita ambos em runtime.
			request: request as unknown as Parameters<typeof wrapRequestHandler>[0]['request'],
			context: ctx
		},
		handler as () => Promise<Response> | Response
	)) as T;
}
