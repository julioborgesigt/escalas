/**
 * Hook para travar o scroll do <body> enquanto um modal/overlay está aberto.
 *
 * Usa contador interno para suportar modais aninhados (ex: confirmar exclusão
 * sobre outro modal): só destrava quando o último consumidor fechar.
 *
 * Compensa a barra de scroll do desktop adicionando padding-right igual à sua
 * largura, evitando o "salto" do layout ao travar/destravar.
 *
 * @param active - função reativa que retorna `true` enquanto o modal estiver aberto.
 *
 * @example
 * let open = $state(false);
 * useScrollLock(() => open);
 */
let lockCount = 0;
let originalOverflow = '';
let originalPaddingRight = '';

export function useScrollLock(active: () => boolean) {
	$effect(() => {
		if (!active()) return;

		if (lockCount === 0) {
			originalOverflow = document.body.style.overflow;
			originalPaddingRight = document.body.style.paddingRight;
			const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
			document.body.style.overflow = 'hidden';
			if (scrollbarWidth > 0) {
				document.body.style.paddingRight = `${scrollbarWidth}px`;
			}
		}
		lockCount++;

		return () => {
			lockCount--;
			if (lockCount === 0) {
				document.body.style.overflow = originalOverflow;
				document.body.style.paddingRight = originalPaddingRight;
			}
		};
	});
}
