import type { LayoutServerLoad } from './$types';
import { getDB, isSupervisorGiseAtiva, isMembroGiseAtiva } from '$lib/db';

export const load: LayoutServerLoad = async ({ locals, platform }) => {
	const u = locals.usuario;

	let isSupervisorGise = false;
	let isMembroGise = false;

	if (u?.tipo === 'policial') {
		try {
			const db = getDB(platform);
			[isSupervisorGise, isMembroGise] = await Promise.all([
				isSupervisorGiseAtiva(db, u.id),
				isMembroGiseAtiva(db, u.id)
			]);
		} catch {
			// DB indisponível
		}
	}

	return {
		usuario: u,
		isSupervisorGise,
		isMembroGise
	};
};
