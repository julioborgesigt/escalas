import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { obterRotaBemVindo } from '$lib/auth';

export const load: PageServerLoad = async ({ locals, cookies }) => {
	const u = locals.usuario;
	if (!u) redirect(302, '/login');

	const adminModulo = cookies.get('admin_modulo');
	const rotaCorreta = obterRotaBemVindo(u, adminModulo);
	if (rotaCorreta !== '/bem-vindo') {
		redirect(302, rotaCorreta);
	}
	return {
		usuario: u
	};
};
