/**
 * Quais requisições renovam o cookie de sessão — e quais não.
 *
 * O `handleAuth` reemite o `session_token` em toda request autenticada: é a
 * metade do sliding que faltava (LGPD A14). Só que "toda request" inclui o
 * POLL DE FUNDO, e aí o controle se anula: a aplicação consulta
 * `/api/sync/estado` a cada 120 s em 17 telas, então uma aba deixada aberta
 * renovava o cookie sozinha, para sempre. O TTL de 1 h só mordia navegador
 * FECHADO — justamente o cenário que já não preocupa.
 *
 * Excluir a rota do poll devolve o sentido a "1 h de inatividade": a aba parada
 * continua consultando (precisa, para autorização), mas o relógio corre. Ação
 * de gente — navegar, salvar, abrir tela — renova.
 *
 * **É uma rota só porque o poll é um só.** Os sete `probe` do
 * `useInvalidateOnFocus` passam todos por `fetchSyncEstado`. Se algum dia
 * nascer um segundo poll de fundo, ele entra nesta lista — senão reabre o
 * buraco em silêncio.
 *
 * O poll também não roda em aba oculta (`refrescar()` sai cedo quando
 * `visibilityState !== 'visible'`), então minimizar já parava de renovar mesmo
 * antes disto. O que esta lista cobre é a aba VISÍVEL e abandonada, que é o
 * terminal de delegacia com a tela ligada.
 */

import { pathnameNoEscopo } from './onboarding-gates';

/**
 * Rotas de POLL de fundo: autenticam normalmente, mas não contam como
 * atividade do usuário para efeito de renovar a sessão.
 */
const ROTAS_DE_POLL = ['/api/sync/estado'] as const;

/**
 * `true` quando esta requisição deve reemitir o cookie de sessão.
 *
 * O DEFAULT é renovar: rota nova nasce contando como atividade, e só sai daqui
 * quem for poll comprovado. O contrário — allowlist de "o que renova" — daria
 * logout silencioso em toda tela que alguém esquecesse de declarar.
 */
export function renovaSessao(pathname: string): boolean {
	return !ROTAS_DE_POLL.some((rota) => pathnameNoEscopo(pathname, rota));
}
