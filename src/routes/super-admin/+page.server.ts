/**
 * Boas-vindas do Super Administrador — console de administração do sistema.
 * Exclusiva do Super Admin (gestão de estrutura + configurações + auditoria).
 */
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const u = locals.usuario;
	if (!u) redirect(302, '/login');
	if (!u.isSuperAdmin) redirect(302, '/');
	return { usuario: u };
};
