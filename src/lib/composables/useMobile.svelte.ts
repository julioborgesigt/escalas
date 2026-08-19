/**
 * Detecção de dispositivo móvel — a fonte ÚNICA do predicado `isMobile`.
 *
 * Isto NÃO é só layout: é o predicado que aplica a flag `restringirSmartphone`
 * ("bloqueia assinatura em desktop, apenas smartphone"), classificada em
 * `server/assinatura/signature-level.ts` como reforço de valor probatório da
 * assinatura. Os call sites que decidem se o painel de assinatura aparece
 * (`escalas/+page.svelte`, `SeccionalRelatoriosDownloads`, `FormularioServico`)
 * leem daqui — por isso a definição precisa ser uma só. Até ago/2026 eram
 * duas: `useGiseEstado` tinha um `MediaQuery('(min-width: 768px)')` próprio e
 * negava o resultado, o que divergia desta EXATAMENTE em 768px (`max-width`
 * inclui o valor, e a negação de `min-width` não) e em qualquer desktop com
 * tela sensível ao toque. Duas telas aplicavam a mesma restrição de assinatura
 * com critérios diferentes.
 *
 * `maxTouchPoints` faz parte do critério DE PROPÓSITO: sem ele, uma janela de
 * navegador estreitada no desktop passaria por smartphone e derrubaria
 * justamente a restrição que a flag existe para impor. O ramo do user-agent
 * cobre o tablet largo, que é móvel sem ser estreito.
 *
 * Isto decide o que a TELA MOSTRA. Quem RECUSA é `ehDispositivoMovelUA` em
 * `server/assinatura/document-utils.ts`, sobre o header da requisição — as duas
 * metades da mesma política, separadas porque os sinais são diferentes
 * (`navigator` aqui, `user-agent` lá). Afrouxar só este lado não afrouxa nada:
 * o POST direto continua morrendo no servidor.
 *
 * Nenhum dos dois sinais é à prova de falsificação — quem controla o navegador
 * controla os dois. A restrição vale como reforço de boa-fé: eleva a qualidade
 * do GPS e da selfie (celular tem GNSS e câmera na mão de quem assina) e afasta
 * o terminal compartilhado destravado. NÃO vincula o aparelho ao assinante.
 *
 * Usa `MediaQuery` do Svelte em vez de listener manual de `resize`.
 *
 * **`isMobile` não responde "a tela é estreita?".** Para isso existe
 * {@link useLarguraDesktop} logo abaixo, e as duas perguntas não são
 * intercambiáveis: um iPad em paisagem tem 1024 px e é móvel. Confundi-las
 * quebra nos dois sentidos — usar `isMobile` para esconder markup deixa o
 * tablet com a UI de celular numa tela larga, e usar a largura para decidir
 * assinatura manda o tablet para o fluxo de token, que ele não tem.
 */
import { MediaQuery } from 'svelte/reactivity';

const UA_MOBILE =
	typeof navigator !== 'undefined' &&
	/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

/**
 * O breakpoint `md` do Tailwind é `min-width: 768px`. `767.98px` é o
 * complemento EXATO dele: nenhuma largura satisfaz os dois, e nenhuma escapa
 * dos dois. Era `max-width: 768px`, que sobrepunha em exatamente 768 px —
 * largura do iPad em retrato, onde o CSS já mostrava a versão desktop enquanto
 * este predicado ainda dizia "mobile".
 */
const ABAIXO_DE_MD = '(max-width: 767.98px)';

export function useMobile() {
	const narrow = new MediaQuery(ABAIXO_DE_MD, false);

	return {
		get isMobile() {
			const touch = typeof navigator !== 'undefined' ? navigator.maxTouchPoints > 0 : false;
			return UA_MOBILE || (narrow.current && touch);
		}
	};
}

/**
 * "A largura da viewport chegou ao `md` do Tailwind?" — e SÓ isso.
 *
 * Use quando o `{#if}` precisa concordar com uma classe `md:` do mesmo bloco:
 * é o caso do `CardGiseAtiva`, cujo botão "Opções" é `md:hidden` e cuja linha
 * de ações só faz sentido aberta quando aquele botão sumiu. Ali `useMobile()`
 * daria a resposta ERRADA: no iPad em paisagem o botão está escondido pelo CSS
 * (1024 ≥ 768) e `isMobile` é `true` pelo user-agent — a linha ficaria fechada
 * sem nada na tela capaz de abri-la.
 *
 * Não use para decidir assinatura, rubrica, token ou qualquer aplicação de
 * `restringirSmartphone`: essas perguntas são sobre o APARELHO e a resposta
 * delas é {@link useMobile}.
 *
 * Fallback `true` (desktop-first) no SSR, o mesmo de `isMobile` ser `false`
 * antes da hidratação — os dois concordam sobre o primeiro paint.
 */
export function useLarguraDesktop() {
	const md = new MediaQuery('(min-width: 768px)', true);

	return {
		get desktop() {
			return md.current;
		}
	};
}
