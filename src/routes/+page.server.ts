import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { obterRotaBemVindo } from '$lib/auth';

export const load: PageServerLoad = async ({ locals, cookies }) => {
	const u = locals.usuario;
	if (!u) redirect(303, '/login');

	const adminModulo = cookies.get('admin_modulo');
	redirect(303, obterRotaBemVindo(u, adminModulo));
};
