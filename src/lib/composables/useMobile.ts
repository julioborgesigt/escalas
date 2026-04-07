/**
 * Hook para detecção de dispositivo móvel.
 *
 * @returns Estado reativo `isMobile`
 *
 * @example
 * const { isMobile } = useMobile();
 */
export function useMobile() {
	let isMobile = $state(true);
	$effect(() => {
		if (typeof window !== 'undefined' && typeof navigator !== 'undefined') {
			isMobile =
				/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
					navigator.userAgent
				) ||
				(window.innerWidth <= 800 && navigator.maxTouchPoints > 0);
		}
	});
	return { get isMobile() { return isMobile; } };
}
