/**
 * Hook para detecção de dispositivo móvel.
 *
 * @returns Estado reativo `isMobile`
 *
 * @example
 * const { isMobile } = useMobile();
 */
export function useMobile() {
	let isMobile = $state(false);
	$effect(() => {
		isMobile =
			/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
				navigator.userAgent
			) || (window.innerWidth <= 768 && navigator.maxTouchPoints > 0);
	});
	return { get isMobile() { return isMobile; } };
}
