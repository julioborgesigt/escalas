import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getDB, buscarExigirFotoAssinatura, buscarExigirGpsAssinatura, buscarExigirCodigoEmailAssinatura, buscarRestringirSmartphone } from '$lib/db';

export const load: PageServerLoad = async ({ locals, platform }) => {
	if (locals.usuario?.tipo !== 'admin') throw redirect(302, '/');

	const db = getDB(platform);
	const [exigirFoto, exigirGps, exigirCodigoEmail, restringirSmartphone] = await Promise.all([
		buscarExigirFotoAssinatura(db),
		buscarExigirGpsAssinatura(db),
		buscarExigirCodigoEmailAssinatura(db),
		buscarRestringirSmartphone(db)
	]);
	return { exigirFoto, exigirGps, exigirCodigoEmail, restringirSmartphone };
};
