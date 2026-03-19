import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	return {
		primeiro_acesso: locals.usuario?.primeiro_acesso ?? false
	};
};
