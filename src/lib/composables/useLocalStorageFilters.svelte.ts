import { browser } from '$app/environment';

export function getSavedFilters<T extends Record<string, any>>(key: string, defaults: T): T {
	if (!browser) return defaults;
	const saved = JSON.parse(localStorage.getItem(key) || '{}');
	return { ...defaults, ...saved };
}
