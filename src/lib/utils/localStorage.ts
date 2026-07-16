import { browser } from '$app/environment';

export function getSavedFilters<T extends Record<string, unknown>>(key: string, defaults: T): T {
	if (!browser) return defaults;
	// JSON corrompido (quota estourada no meio do setItem, extensão, edição
	// manual) não pode derrubar a página: o parse roda durante a inicialização
	// do componente e uma exceção aqui quebraria a rota inteira.
	try {
		const saved: unknown = JSON.parse(localStorage.getItem(key) || '{}');
		if (typeof saved !== 'object' || saved === null || Array.isArray(saved)) return defaults;
		return { ...defaults, ...saved };
	} catch {
		return defaults;
	}
}
