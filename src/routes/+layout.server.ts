import type { LayoutServerLoad } from './$types';
import { getDB } from '$lib/db';
import { lerFlagsAssinatura } from '$lib/server/cfg-ass-cache';
import { lerPapelGise } from '$lib/server/gise-papel-cache';
import { logger } from '$lib/server/logger';

export const load: LayoutServerLoad = async ({ locals, platform, cookies }) => {
	const u = locals.usuario;

	let isSupervisorGise = false;
	let isMembroGise = false;
	let isSupervisaoGise = false;
	let exigirFotoAssinatura = true;
	let exigirGpsAssinatura = true;
	let exigirCodigoEmailAssinatura = false;
	let restringirSmartphone = false;

	if (u) {
		try {
			// Flags vêm do cache server-side (Cache API edge, TTL 5min). Antes
			// usávamos cookie do cliente, mas como não era assinado, o usuário
			// podia editá-lo e desligar exigências de selfie/GPS/código.
			// Esses valores são EXIBIÇÃO; toda decisão de aceitar/dispensar
			// evidência DEVE chamar `lerFlagsAssinatura` no próprio endpoint.
			//
			// Papel GISE vem do cache edge (TTL 60s). Mutações diretas
			// (mudar supervisor, add/remove membro) invalidam o cache no
			// próprio handler, então o stale window real é só para
			// cascatas raras (ex.: deletar uma seccional inteira).
			const db = u.tipo === 'policial' ? getDB(platform) : null;
			const [flags, papel] = await Promise.all([
				lerFlagsAssinatura(platform),
				db ? lerPapelGise(db, u.id) : Promise.resolve(null)
			]);
			exigirFotoAssinatura = flags.exigirFotoAssinatura;
			exigirGpsAssinatura = flags.exigirGpsAssinatura;
			exigirCodigoEmailAssinatura = flags.exigirCodigoEmailAssinatura;
			restringirSmartphone = flags.restringirSmartphone;

			if (papel) {
				isSupervisorGise = papel.isSupervisor;
				isMembroGise = papel.isMembro;
				isSupervisaoGise = papel.isSupervisao;
			}
		} catch (err) {
			// DB/edge cache indisponível — mantém defaults seguros (exige tudo)
			logger.warn('[layout] falha ao carregar flags/papel GISE', {
				err: err instanceof Error ? err.message : String(err)
			});
		}
	}

	// Admin module scope set at login
	const rawAdminModulo = cookies.get('admin_modulo');
	const adminModulo: 'ambas' | 'gise' | 'escalas' =
		rawAdminModulo === 'gise' || rawAdminModulo === 'escalas' ? rawAdminModulo : 'ambas';

	// Licença Lacuna Web PKI — propagada do env para o cliente. Não é segredo;
	// é um identificador de domínio assinado pela Lacuna. Em ausência, o
	// fluxo Web PKI falha em produção e usuário deve usar SERPRO.
	const env = platform?.env as Env | undefined;
	const webPkiLicense = env?.WEBPKI_LICENSE ?? null;

	return {
		usuario: u,
		isSupervisorGise,
		isMembroGise,
		isSupervisaoGise,
		exigirFotoAssinatura,
		exigirGpsAssinatura,
		exigirCodigoEmailAssinatura,
		restringirSmartphone,
		adminModulo,
		webPkiLicense
	};
};
