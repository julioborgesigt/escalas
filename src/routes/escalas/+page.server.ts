import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const u = locals.usuario;
	if (!u) throw redirect(302, '/login');

	if (u.tipo !== 'admin' && u.papel !== 'admin_seccional' && u.papel !== 'admin_unidade') {
		throw redirect(302, '/');
	}
};
