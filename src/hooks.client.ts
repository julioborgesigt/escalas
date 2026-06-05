/**
 * Hooks do cliente — captura de erros de JS no browser via Sentry.
 *
 * Complementa o Sentry do servidor (@sentry/cloudflare em hooks.server.ts): o
 * fluxo crítico de assinatura (SignaturePad, face-api, Assinador SERPRO) roda
 * NO cliente, então exceções ali eram um ponto cego. Sem PUBLIC_SENTRY_DSN o
 * SDK não inicializa (no-op) — útil em dev/local.
 *
 * O DSN é público por natureza (vai no bundle do cliente). Configure
 * PUBLIC_SENTRY_DSN no ambiente (Cloudflare Pages) para ativar; o host do
 * Sentry já está liberado no `connect-src` da CSP (svelte.config.js).
 */
import * as Sentry from '@sentry/browser';
import { env } from '$env/dynamic/public';
import type { HandleClientError } from '@sveltejs/kit';

const dsn = env.PUBLIC_SENTRY_DSN;

if (dsn) {
	Sentry.init({
		dsn,
		environment: env.PUBLIC_SENTRY_ENVIRONMENT || 'production',
		// Só captura de exceções por ora (sem tracing/replay) — footprint menor.
		tracesSampleRate: 0,
		// Não anexa IP/headers por padrão (LGPD).
		sendDefaultPii: false
	});
}

export const handleError: HandleClientError = ({ error, event, status, message }) => {
	// Mesmo contrato do handleError do servidor: devolve um errorId rastreável e
	// uma mensagem genérica (a +error.svelte exibe "Ref: {errorId}").
	const errorId = crypto.randomUUID().slice(0, 8);
	if (dsn) {
		Sentry.captureException(error, {
			tags: { errorId, path: event.url.pathname },
			extra: { status, message }
		});
	}
	return {
		message: 'Ocorreu um erro inesperado. Tente novamente.',
		errorId
	};
};
