/**
 * Hook para detecção de dispositivo móvel (UA clássico ou viewport estreito + touch).
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
