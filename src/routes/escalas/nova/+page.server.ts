import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/**
 * Rota legada — a página completa de criação foi substituída pelo fluxo do
 * `ModalNovaEscala` na própria `/escalas` (card "Nova Escala"). Este stub só
 * existe como cortesia para favoritos antigos; nenhuma tela linka para cá.
 */
export const load: PageServerLoad = async () => {
	redirect(301, '/escalas');
};
