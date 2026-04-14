import type { LayoutServerLoad } from './$types';
import { getDB, isSupervisorGiseAtiva, isMembroGiseAtiva, buscarExigirFotoAssinatura, buscarExigirGpsAssinatura, buscarExigirCodigoEmailAssinatura } from '$lib/db';

/** Nome do cookie de cache das flags de configuração de assinatura. */
const CFG_ASS_COOKIE = 'cfg_ass';
/** TTL do cache: 5 minutos. Elimina queries redundantes em toda navegação. */
const CFG_ASS_MAX_AGE = 300;

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

			// Flags de config lidas do cookie em cache (evita 3 queries por navegação).
			// Só consulta o DB se o cookie estiver ausente ou expirado.
			const cfgCookie = cookies.get(CFG_ASS_COOKIE);
			if (cfgCookie) {
				const cfg = JSON.parse(cfgCookie);
				exigirFotoAssinatura = cfg.foto === 1;
				exigirGpsAssinatura = cfg.gps === 1;
				exigirCodigoEmailAssinatura = cfg.codigo === 1;
			} else {
				await Promise.all([
					buscarExigirFotoAssinatura(db).then((v) => { exigirFotoAssinatura = v; }),
					buscarExigirGpsAssinatura(db).then((v) => { exigirGpsAssinatura = v; }),
					buscarExigirCodigoEmailAssinatura(db).then((v) => { exigirCodigoEmailAssinatura = v; })
				]);
				cookies.set(CFG_ASS_COOKIE, JSON.stringify({
					foto: exigirFotoAssinatura ? 1 : 0,
					gps: exigirGpsAssinatura ? 1 : 0,
					codigo: exigirCodigoEmailAssinatura ? 1 : 0
				}), { path: '/', httpOnly: false, sameSite: 'lax', maxAge: CFG_ASS_MAX_AGE });
			}

			if (u.tipo === 'policial') {
				await Promise.all([
					isSupervisorGiseAtiva(db, u.id).then((v) => { isSupervisorGise = v; }),
					isMembroGiseAtiva(db, u.id).then((v) => { isMembroGise = v; })
				]);
			}
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
