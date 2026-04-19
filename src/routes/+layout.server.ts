import type { LayoutServerLoad } from './$types';
import { getDB } from '$lib/db';
import { lerFlagsAssinatura } from '$lib/server/cfg-ass-cache';
import { lerPapelGise } from '$lib/server/gise-papel-cache';

export const load: LayoutServerLoad = async ({ locals, platform, cookies }) => {
	const u = locals.usuario;

	let isSupervisorGise = false;
	let isMembroGise = false;
	let isSupervisaoGise = false;
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
				// Papel GISE vem do cache edge (TTL 60s). Mutações diretas
				// (mudar supervisor, add/remove membro) invalidam o cache no
				// próprio handler, então o stale window real é só para
				// cascatas raras (ex.: deletar uma seccional inteira).
				const db = getDB(platform);
				const papel = await lerPapelGise(db, u.id);
				isSupervisorGise = papel.isSupervisor;
				isMembroGise = papel.isMembro;
				isSupervisaoGise = papel.isSupervisao;
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
		isSupervisaoGise,
		exigirFotoAssinatura,
		exigirGpsAssinatura,
		exigirCodigoEmailAssinatura,
		adminModulo
	};
};
