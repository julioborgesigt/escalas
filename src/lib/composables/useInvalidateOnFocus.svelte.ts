/**
 * Revalida um `depends(...)` quando:
 *  - a aba volta ao foco (`visibilitychange`);
 *  - outra aba do mesmo browser notifica via BroadcastChannel;
 *  - um poll silencioso enquanto a aba está visível.
 *
 * Poll “quente” vs “frio”: estados ativos (pendências, GISE em curso) usam
 * intervalo curto; o restante usa intervalo longo (ou só foco + broadcast).
 */
import { browser } from '$app/environment';
import { invalidate } from '$app/navigation';
import { subscribeInvalidate } from '$lib/cross-tab-invalidate';

const INTERVALO_QUENTE_MS = 30_000;
const INTERVALO_FRIO_MS = 120_000;

export function useInvalidateOnFocus(
	chave: string,
	opcoes?: {
		/**
		 * Intervalo fixo (legado). Se omitido, usa quente/frio conforme `isHot`.
		 * `0` desliga o poll (mantém foco + broadcast).
		 */
		intervalMs?: number;
		/** Intervalo quando `isHot()` é true. Default 30s. */
		hotIntervalMs?: number;
		/** Intervalo quando `isHot()` é false. Default 120s. */
		coldIntervalMs?: number;
		/**
		 * Getter reativo: chamado dentro do `$effect` para o intervalo acompanhar
		 * o estado da página (ex.: status GISE, filtro “não vistos”).
		 */
		isHot?: () => boolean;
	}
) {
	$effect(() => {
		if (!browser) return;

		const hot = opcoes?.isHot?.() ?? false;
		const intervalMs =
			opcoes?.intervalMs !== undefined
				? opcoes.intervalMs
				: hot
					? (opcoes?.hotIntervalMs ?? INTERVALO_QUENTE_MS)
					: (opcoes?.coldIntervalMs ?? INTERVALO_FRIO_MS);

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
		const unscribeTab = subscribeInvalidate(chave, () => {
			void refrescar();
		});
		const timer =
			intervalMs > 0
				? setInterval(() => {
						void refrescar();
					}, intervalMs)
				: null;

		return () => {
			document.removeEventListener('visibilitychange', aoMudarVisibilidade);
			unscribeTab();
			if (timer) clearInterval(timer);
		};
	});
}
