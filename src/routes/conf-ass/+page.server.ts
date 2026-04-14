import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getDB, buscarExigirFotoAssinatura, buscarExigirGpsAssinatura, buscarExigirCodigoEmailAssinatura, buscarRestringirSmartphone } from '$lib/db';

export const load: PageServerLoad = async ({ locals, platform, cookies }) => {
	if (locals.usuario?.tipo !== 'admin') throw redirect(302, '/');

	const db = getDB(platform);

	// Aproveita o cache do layout para as 3 flags comuns; busca restringirSmartphone separado
	const cfgCookie = cookies.get('cfg_ass');
	let exigirFoto: boolean;
	let exigirGps: boolean;
	let exigirCodigoEmail: boolean;

	if (cfgCookie) {
		const cfg = JSON.parse(cfgCookie);
		exigirFoto = cfg.foto === 1;
		exigirGps = cfg.gps === 1;
		exigirCodigoEmail = cfg.codigo === 1;
	} else {
		[exigirFoto, exigirGps, exigirCodigoEmail] = await Promise.all([
			buscarExigirFotoAssinatura(db),
			buscarExigirGpsAssinatura(db),
			buscarExigirCodigoEmailAssinatura(db)
		]);
	}

	// restringirSmartphone não está em cache — query isolada
	const restringirSmartphone = await buscarRestringirSmartphone(db);

	return { exigirFoto, exigirGps, exigirCodigoEmail, restringirSmartphone };
};
