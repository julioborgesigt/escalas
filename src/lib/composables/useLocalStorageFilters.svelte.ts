import { browser } from '$app/environment';

export function useLocalStorageFilters<T extends Record<string, any>>(key: string, defaults: T): T {
	let state = $state<T>(
		browser ? { ...defaults, ...JSON.parse(localStorage.getItem(key) || '{}') } : { ...defaults }
	);

	$effect(() => {
		if (browser) {
			localStorage.setItem(key, JSON.stringify(state));
		}
	});

	return state;
}

export function createLocalStorageSync<T extends Record<string, any>>(
	key: string,
	defaults: T
): {
	getSaved: () => Partial<T>;
	sync: (getState: () => T) => void;
} {
	const saved = browser ? JSON.parse(localStorage.getItem(key) || '{}') : {};

	return {
		getSaved: () => saved as Partial<T>,
		sync: (getState: () => T) => {
			if (browser) {
				localStorage.setItem(key, JSON.stringify(getState()));
			}
		}
	};
}

export function getSavedFilters<T extends Record<string, any>>(key: string, defaults: T): T {
	if (!browser) return defaults;
	const saved = JSON.parse(localStorage.getItem(key) || '{}');
	return { ...defaults, ...saved };
}
