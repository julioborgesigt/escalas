/**
 * Hooks do cliente — captura de erros de JS no browser via Sentry.
 *
 * Complementa o Sentry do servidor (@sentry/cloudflare em hooks.server.ts): o
 * fluxo crítico de assinatura (SignaturePad, face-api, Assinador SERPRO) roda
 * NO cliente, então exceções ali eram um ponto cego. Sem PUBLIC_SENTRY_DSN o
 * SDK não inicializa (no-op) — útil em dev/local.
 *
 * O SDK é carregado via import() DINÂMICO após a hidratação (idle): o import
 * estático fundia ~60 kB gz de Sentry no chunk do runtime, pago por TODA
 * página antes do primeiro paint. Erros que ocorram antes do SDK chegar não
 * se perdem — entram numa fila e são enviados assim que o init completa.
 * Trade-off consciente: exceções fora do handleError (window.onerror) nos
 * primeiros ~1-2s não são capturadas; o fluxo crítico (assinatura) acontece
 * muito depois da hidratação.
 *
 * O DSN é público por natureza (vai no bundle do cliente). Configure
 * PUBLIC_SENTRY_DSN no ambiente (Cloudflare Pages) para ativar; o host do
 * Sentry já está liberado no `connect-src` da CSP (svelte.config.js).
 */
import { env } from '$env/dynamic/public';
import type { HandleClientError } from '@sveltejs/kit';

const dsn = env.PUBLIC_SENTRY_DSN;

type SentryModule = typeof import('@sentry/browser');
let sentry: SentryModule | null = null;
const capturasPendentes: Array<(mod: SentryModule) => void> = [];

if (dsn) {
	const carregarSentry = () => {
		import('@sentry/browser')
			.then((mod) => {
				mod.init({
					dsn,
					environment: env.PUBLIC_SENTRY_ENVIRONMENT || 'production',
					// Só captura de exceções por ora (sem tracing/replay) — footprint menor.
					tracesSampleRate: 0,
					// Não anexa IP/headers por padrão (LGPD).
					sendDefaultPii: false
				});
				sentry = mod;
				for (const captura of capturasPendentes.splice(0)) captura(mod);
			})
			.catch(() => {
				// Sentry indisponível (rede/CSP) — app segue sem telemetria de erros.
			});
	};
	if ('requestIdleCallback' in window) {
		requestIdleCallback(() => carregarSentry(), { timeout: 3000 });
	} else {
		setTimeout(carregarSentry, 2000);
	}
}

export const handleError: HandleClientError = ({ error, event, status, message }) => {
	// Mesmo contrato do handleError do servidor: devolve um errorId rastreável e
	// uma mensagem genérica (a +error.svelte exibe "Ref: {errorId}").
	const errorId = crypto.randomUUID().slice(0, 8);
	if (dsn) {
		const captura = (mod: SentryModule) =>
			mod.captureException(error, {
				tags: { errorId, path: event.url.pathname },
				extra: { status, message }
			});
		if (sentry) captura(sentry);
		else capturasPendentes.push(captura);
	}
	return {
		message: 'Ocorreu um erro inesperado. Tente novamente.',
		errorId
	};
};
