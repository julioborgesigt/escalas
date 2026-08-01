import type { LayoutServerLoad } from './$types';
import { getDB, ehAdminGeralVinculado } from '$lib/db';
import { lerFlagsAssinatura } from '$lib/server/assinatura/cfg-ass-cache';
import { lerPapelGise } from '$lib/server/gise/papel-cache';
import { temAssinaturaEscalaPendente } from '$lib/server/escalas/rubrica-pendente';
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
	let precisaCadastrarRubrica = false;
	// Alternância de acesso (ADM Geral ↔ Usuário) para a MESMA pessoa vinculada.
	// admin → usuário: exige a sessão admin ter policial vinculado (adminPolicialId).
	// usuário → admin: exige o policial ter conta Admin Geral vinculada.
	const podeAlternarParaUsuario = u?.tipo === 'admin' && u.adminPolicialId != null;
	let podeAlternarParaAdmin = false;

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
			const [flags, papel, vinculadoAdmin] = await Promise.all([
				lerFlagsAssinatura(platform),
				db ? lerPapelGise(db, u.id) : Promise.resolve(null),
				db ? ehAdminGeralVinculado(db, u.id) : Promise.resolve(false)
			]);
			podeAlternarParaAdmin = vinculadoAdmin;
			exigirFotoAssinatura = flags.exigirFotoAssinatura;
			exigirGpsAssinatura = flags.exigirGpsAssinatura;
			exigirCodigoEmailAssinatura = flags.exigirCodigoEmailAssinatura;
			restringirSmartphone = flags.restringirSmartphone;

			if (papel) {
				isSupervisorGise = papel.isSupervisor;
				isMembroGise = papel.isMembro;
				isSupervisaoGise = papel.isSupervisao;
			}

			// Aviso "cadastre sua rubrica": só para policial SEM rubrica com
			// pendência concreta de assinatura — vínculo com GISE ativa (presenças/
			// relatórios a assinar) ou solicitação de assinatura de escala dirigida
			// a ele (DPC admin). A checagem extra de solicitação só roda nesse caso
			// raro (1 EXISTS); `temRubrica` vem da própria sessão.
			if (db && u.tipo === 'policial' && u.temRubrica === false) {
				const papelGiseAtivo = isSupervisorGise || isMembroGise || isSupervisaoGise;
				precisaCadastrarRubrica = papelGiseAtivo || (await temAssinaturaEscalaPendente(db, u));
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

	return {
		usuario: u,
		isSupervisorGise,
		isMembroGise,
		isSupervisaoGise,
		exigirFotoAssinatura,
		exigirGpsAssinatura,
		exigirCodigoEmailAssinatura,
		restringirSmartphone,
		precisaCadastrarRubrica,
		adminModulo,
		podeAlternarParaUsuario,
		podeAlternarParaAdmin
	};
};
