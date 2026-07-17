import { redirect } from '@sveltejs/kit';
import { VERSAO } from '$lib/server/termo/termo-vigente';
import type { PageServerLoad } from './$types';

/**
 * `/termo` → versão vigente. Links de UI (avisos jurídicos dos painéis de
 * assinatura) apontam para cá em vez de fixar a versão — antes ficavam
 * hardcoded (`/termo/1.0`) e quebravam a cada bump do termo, já que
 * `/termo/[versao]` só serve a versão vigente.
 */
export const load: PageServerLoad = () => {
	redirect(302, `/termo/${VERSAO}`);
};
