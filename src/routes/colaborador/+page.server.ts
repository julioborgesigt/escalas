/**
 * Boas-vindas do COLABORADOR — a terceira identidade. Hoje é a tela vazia que
 * o plano do módulo de diárias descreve como critério da fase 2: "um
 * colaborador consegue entrar, aceitar o termo e ver uma tela vazia — e não
 * consegue nada além disso". As funções designadas (protocolo, analista)
 * passam a aparecer aqui quando existirem.
 */
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { obterRotaBemVindo } from '$lib/auth';

export const load: PageServerLoad = async ({ locals }) => {
	const u = locals.usuario;
	if (!u) redirect(302, '/login');
	// Policial e admin têm as próprias boas-vindas; esta é só do colaborador.
	if (u.tipo !== 'colaborador') redirect(302, obterRotaBemVindo(u));
	return { usuario: u };
};
