import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getDB, buscarExigirFotoAssinatura, buscarExigirGpsAssinatura } from '$lib/db';

export const load: PageServerLoad = async ({ locals, platform }) => {
	if (locals.usuario?.tipo !== 'admin') throw redirect(302, '/');

	const db = getDB(platform);
	const [exigirFoto, exigirGps] = await Promise.all([
		buscarExigirFotoAssinatura(db),
		buscarExigirGpsAssinatura(db)
	]);
	return { exigirFoto, exigirGps };
};
