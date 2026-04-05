import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getDB, buscarExigirFotoAssinatura } from '$lib/db';

export const load: PageServerLoad = async ({ locals, platform }) => {
	if (locals.usuario?.tipo !== 'admin') throw redirect(302, '/');

	const db = getDB(platform);
	const exigirFoto = await buscarExigirFotoAssinatura(db);
	return { exigirFoto };
};
