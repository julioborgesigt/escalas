/**
 * Revalida um `depends(...)` quando a aba volta ao foco e, opcionalmente,
 * em intervalo enquanto estiver visível. Cobre o gap cross-user sem WebSocket:
 * quem deixou `/recebidos` ou `/gise/[id]` abertos vê dados frescos ao voltar
 * (ou a cada tick), sem F5.
 *
 * O refresh é silencioso — sem overlay de loading — para não interromper leitura.
 */
import { browser } from '$app/environment';
import { invalidate } from '$app/navigation';

const INTERVALO_PADRAO_MS = 90_000;

export function useInvalidateOnFocus(
	chave: string,
	opcoes?: {
		/** Intervalo em ms enquanto a aba está visível. `0` desliga o poll. */
		intervalMs?: number;
	}
) {
	const intervalMs = opcoes?.intervalMs ?? INTERVALO_PADRAO_MS;

	$effect(() => {
		if (!browser) return;

		let emCurso = false;
		async function refrescar() {
			if (emCurso || document.visibilityState !== 'visible') return;
			emCurso = true;
			try {
				await invalidate(chave);
			} finally {
				emCurso = false;
			}
		}

		function aoMudarVisibilidade() {
			if (document.visibilityState === 'visible') void refrescar();
		}

		document.addEventListener('visibilitychange', aoMudarVisibilidade);
		const timer =
			intervalMs > 0
				? setInterval(() => {
						void refrescar();
					}, intervalMs)
				: null;

		return () => {
			document.removeEventListener('visibilitychange', aoMudarVisibilidade);
			if (timer) clearInterval(timer);
		};
	});
}
