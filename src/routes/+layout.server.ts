import type { LayoutServerLoad } from './$types';
import { getDB, isSupervisorGiseAtiva } from '$lib/db';

export const load: LayoutServerLoad = async ({ locals, platform }) => {
	const u = locals.usuario;

	let isSupervisorGise = false;
	if (u?.tipo === 'policial') {
		try {
			const db = getDB(platform);
			isSupervisorGise = await isSupervisorGiseAtiva(db, u.id);
		} catch {
			// DB indisponível
		}
	}

	return {
		usuario: u,
		isSupervisorGise
	};
};
