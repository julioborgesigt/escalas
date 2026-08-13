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
 * Nenhum dos dois sinais é à prova de falsificação — quem controla o navegador
 * controla os dois. A restrição vale como reforço de boa-fé, não como gate: o
 * servidor registra o user-agent na evidência da assinatura, mas não recusa
 * por dispositivo.
 *
 * Usa `MediaQuery` do Svelte em vez de listener manual de `resize`.
 */
import { MediaQuery } from 'svelte/reactivity';

const UA_MOBILE =
	typeof navigator !== 'undefined' &&
	/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

export function useMobile() {
	const narrow = new MediaQuery('(max-width: 768px)', false);

	return {
		get isMobile() {
			const touch = typeof navigator !== 'undefined' ? navigator.maxTouchPoints > 0 : false;
			return UA_MOBILE || (narrow.current && touch);
		}
	};
}
