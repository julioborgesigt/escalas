import type { LayoutServerLoad } from './$types';
import { getDB, isSupervisorGiseAtiva, isMembroGiseAtiva, buscarExigirFotoAssinatura, buscarExigirGpsAssinatura, buscarExigirCodigoEmailAssinatura } from '$lib/db';

export const load: LayoutServerLoad = async ({ locals, platform, cookies }) => {
	const u = locals.usuario;

	let isSupervisorGise = false;
	let isMembroGise = false;
	let exigirFotoAssinatura = true;
	let exigirGpsAssinatura = true;
	let exigirCodigoEmailAssinatura = false;

	if (u) {
		try {
			const db = getDB(platform);
			const checks: Promise<unknown>[] = [
				buscarExigirFotoAssinatura(db).then((v) => { exigirFotoAssinatura = v; }),
				buscarExigirGpsAssinatura(db).then((v) => { exigirGpsAssinatura = v; }),
				buscarExigirCodigoEmailAssinatura(db).then((v) => { exigirCodigoEmailAssinatura = v; })
			];
			if (u.tipo === 'policial') {
				checks.push(
					isSupervisorGiseAtiva(db, u.id).then((v) => { isSupervisorGise = v; }),
					isMembroGiseAtiva(db, u.id).then((v) => { isMembroGise = v; })
				);
			}
			await Promise.all(checks);
		} catch {
			// DB indisponível
		}
	}

	// Admin module scope set at login
	const rawAdminModulo = cookies.get('admin_modulo');
	const adminModulo: 'ambas' | 'gise' | 'escalas' =
		rawAdminModulo === 'gise' || rawAdminModulo === 'escalas' ? rawAdminModulo : 'ambas';

	return {
		usuario: u,
		isSupervisorGise,
		isMembroGise,
		exigirFotoAssinatura,
		exigirGpsAssinatura,
		exigirCodigoEmailAssinatura,
		adminModulo
	};
};
