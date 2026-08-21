/**
 * Quando o `Origin` é OBRIGATÓRIO, e não apenas conferido.
 *
 * Extraído do `handleCsrf` pelo mesmo motivo do `onboarding-gates.ts`: a regra
 * fica testável sem montar o middleware.
 *
 * O padrão double-submit cobre `/api/*` inteiro, menos o que está em
 * `CSRF_EXEMPT_ROUTES`. Nos isentos não há token a comparar, e aí o `Origin` é
 * a única camada — mas os três isentos não querem a mesma coisa:
 *
 * - `/api/auth/login` — isento porque ainda não existe sessão nem token. O
 *   cliente legítimo é sempre um browser mesma-origem, que manda `Origin` em
 *   todo POST. Exigir a presença fecha o forced-login por cliente não-browser
 *   (SEC-14); antes, `Origin` DIVERGENTE morria e `Origin` AUSENTE passava.
 * - `/api/webhook/*` — origem externa legítima, sem browser e sem `Origin`.
 *   Autentica por Bearer/HMAC + replay. Exigir `Origin` aqui quebraria a
 *   integração inteira.
 * - `/api/health` — sonda externa (UptimeRobot e afins). Mesmo caso.
 *
 * A form action de `/login` NÃO precisa desta regra: o `csrf.checkOrigin` do
 * próprio SvelteKit (ligado por default, sem override no `svelte.config.js`)
 * compara `headers.get('origin') !== url.origin` para POST de formulário, e
 * `null !== origin` já reprova. O buraco do SEC-14 era só da rota JSON.
 */

import { pathnameNoEscopo } from './onboarding-gates';

/** Isentos de token CSRF em que o `Origin` precisa ESTAR presente. */
const ORIGIN_OBRIGATORIO = ['/api/auth/login'] as const;

/**
 * `true` quando a rota exige `Origin` presente **e** casando com a nossa
 * origem. `false` mantém o comportamento antigo: confere se veio, ignora se não.
 */
export function exigeOriginPresente(pathname: string): boolean {
	return ORIGIN_OBRIGATORIO.some((rota) => pathnameNoEscopo(pathname, rota));
}

/**
 * Decide o veredito de origem de uma requisição que muda estado.
 *
 * `origin` é o header cru (`null` quando ausente). Devolve `true` para recusar.
 */
export function deveRecusarPorOrigem(
	pathname: string,
	origin: string | null,
	origemEsperada: string
): boolean {
	if (origin === null) return exigeOriginPresente(pathname);
	return origin !== origemEsperada;
}
