import { browser } from '$app/environment';

/**
 * Hook reutilizável para filtros com persistência em localStorage.
 *
 * @param key - Chave para armazenar no localStorage
 * @param defaults - Valores padrão dos filtros
 * @returns Objeto reativo com os filtros (pode ser modificado diretamente)
 *
 * @example
 * const filters = useLocalStorageFilters('filtros_policiais', {
 *   cargo: '',
 *   busca: ''
 * });
 *
 * // Uso no componente:
 * let filtroCargo = $state(filters.cargo);
 * let filtroBusca = $state(filters.busca);
 *
 * $effect(() => {
 *   filters.cargo = filtroCargo;
 *   filters.busca = filtroBusca;
 * });
 */
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
				// $effect vai chamar isso automaticamente
				localStorage.setItem(key, JSON.stringify(getState()));
			}
		}
	};
}

/**
 * Hook simplificado: retorna valores salvos do localStorage.
 * O componente cuida do $effect para salvar.
 *
 * @param key - Chave para armazenar no localStorage
 * @param defaults - Valores padrão dos filtros
 * @returns Valores salvos ou defaults
 *
 * @example
 * const saved = getSavedFilters('filtros_recebidos', {
 *   timeRange: 'todos',
 *   seccional: ''
 * });
 *
 * let filtroTimeRange = $state(saved.timeRange);
 * let filtroSeccional = $state(saved.seccional);
 *
 * $effect(() => {
 *   if (browser) {
 *     localStorage.setItem(KEY, JSON.stringify({
 *       timeRange: filtroTimeRange,
 *       seccional: filtroSeccional
 *     }));
 *   }
 * });
 */
export function getSavedFilters<T extends Record<string, any>>(
	key: string,
	defaults: T
): T {
	if (!browser) return defaults;
	const saved = JSON.parse(localStorage.getItem(key) || '{}');
	return { ...defaults, ...saved };
}
