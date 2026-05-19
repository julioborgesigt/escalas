import { browser } from '$app/environment';

export function getSavedFilters<T extends Record<string, unknown>>(key: string, defaults: T): T {
	if (!browser) return defaults;
	try {
		const saved = JSON.parse(localStorage.getItem(key) || '{}');
		return { ...defaults, ...saved };
	} catch {
		return defaults;
	}
}
