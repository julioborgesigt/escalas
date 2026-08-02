/**
 * True quando a navegação client-side é só troca de query na mesma rota
 * (filtros/paginação) — o padrão das listas com skeleton inline.
 */
import { page, navigating } from '$app/state';

export function useSamePathNavigating() {
	return {
		get current() {
			const to = navigating.to;
			return Boolean(to && to.url.pathname === page.url.pathname);
		}
	};
}
