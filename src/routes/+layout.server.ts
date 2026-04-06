import type { LayoutServerLoad } from './$types';
import { getDB, isSupervisorGiseAtiva, isMembroGiseAtiva, buscarExigirFotoAssinatura, buscarExigirGpsAssinatura } from '$lib/db';

export const load: LayoutServerLoad = async ({ locals, platform }) => {
	const u = locals.usuario;

	let isSupervisorGise = false;
	let isMembroGise = false;
	let exigirFotoAssinatura = true;
	let exigirGpsAssinatura = true;

	if (u) {
		try {
			const db = getDB(platform);
			const checks: Promise<unknown>[] = [
				buscarExigirFotoAssinatura(db).then((v) => { exigirFotoAssinatura = v; }),
				buscarExigirGpsAssinatura(db).then((v) => { exigirGpsAssinatura = v; })
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

	return {
		usuario: u,
		isSupervisorGise,
		isMembroGise,
		exigirFotoAssinatura,
		exigirGpsAssinatura
	};
};
