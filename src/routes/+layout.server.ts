import type { LayoutServerLoad } from './$types';
import { getDB, isSupervisorGiseAtiva, isMembroGiseAtiva } from '$lib/db';
import { lerFlagsAssinatura } from '$lib/server/cfg-ass-cache';

export const load: LayoutServerLoad = async ({ locals, platform, cookies }) => {
	const u = locals.usuario;

	let isSupervisorGise = false;
	let isMembroGise = false;
	let exigirFotoAssinatura = true;
	let exigirGpsAssinatura = true;
	let exigirCodigoEmailAssinatura = false;

	if (u) {
		try {
			// Flags vêm do cache server-side (Cache API edge, TTL 5min). Antes
			// usávamos cookie do cliente, mas como não era assinado, o usuário
			// podia editá-lo e desligar exigências de selfie/GPS/código.
			// Esses valores são EXIBIÇÃO; toda decisão de aceitar/dispensar
			// evidência DEVE chamar `lerFlagsAssinatura` no próprio endpoint.
			const flags = await lerFlagsAssinatura(platform);
			exigirFotoAssinatura = flags.exigirFotoAssinatura;
			exigirGpsAssinatura = flags.exigirGpsAssinatura;
			exigirCodigoEmailAssinatura = flags.exigirCodigoEmailAssinatura;

			if (u.tipo === 'policial') {
				const db = getDB(platform);
				await Promise.all([
					isSupervisorGiseAtiva(db, u.id).then((v) => { isSupervisorGise = v; }),
					isMembroGiseAtiva(db, u.id).then((v) => { isMembroGise = v; })
				]);
			}
		} catch {
			// DB indisponível — mantém defaults seguros (exige tudo)
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
