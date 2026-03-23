import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (locals.usuario?.tipo === 'admin') {
		throw redirect(303, '/painel');
	}
};
