/**
 * Revalida um `depends(...)` quando:
 *  - a aba volta ao foco (`visibilitychange`);
 *  - outra aba do mesmo browser notifica via BroadcastChannel;
 *  - um poll silencioso enquanto a aba está visível.
 *
 * Com `probe`, o poll/foco só chama `invalidate` se o carimbo mudou
 * (`GET /api/sync/estado`) — evita rerodar o `load` pesado a cada tick.
 * Notificação cross-tab continua forçando invalidate (já sabemos que mudou).
 *
 * Poll “quente” vs “frio”: estados ativos usam intervalo curto; o restante, longo.
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
		/**
		 * Carimbo leve (ex.: stamp de `/api/sync/estado`). Se igual ao anterior,
		 * o poll/foco NÃO invalida. Em falha de rede devolve `null` e ignora o tick.
		 */
		probe?: () => Promise<string | null>;
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
		let ultimoStamp: string | null = null;

		async function refrescar(force = false) {
			if (emCurso || document.visibilityState !== 'visible') return;
			emCurso = true;
			try {
				if (!force && opcoes?.probe) {
					const stamp = await opcoes.probe();
					if (stamp === null) return;
					// Primeiro tick só semeia o carimbo — o `load` já veio fresco.
					if (ultimoStamp === null) {
						ultimoStamp = stamp;
						return;
					}
					if (stamp === ultimoStamp) return;
					ultimoStamp = stamp;
				}
				await invalidate(chave);
				if (force && opcoes?.probe) {
					try {
						ultimoStamp = await opcoes.probe();
					} catch {
						/* carimbo pós-invalidate é best-effort */
					}
				}
			} finally {
				emCurso = false;
			}
		}

		function aoMudarVisibilidade() {
			if (document.visibilityState === 'visible') void refrescar(false);
		}

		document.addEventListener('visibilitychange', aoMudarVisibilidade);
		const unscribeTab = subscribeInvalidate(chave, () => {
			void refrescar(true);
		});
		const timer =
			intervalMs > 0
				? setInterval(() => {
						void refrescar(false);
					}, intervalMs)
				: null;

		return () => {
			document.removeEventListener('visibilitychange', aoMudarVisibilidade);
			unscribeTab();
			if (timer) clearInterval(timer);
		};
	});
}
