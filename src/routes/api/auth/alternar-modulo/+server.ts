import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { obterRotaBemVindo } from '$lib/auth';
import { cookieOptions } from '$lib/server/auth/auth-flow';
import { requireAdmin, forbidden } from '$lib/server/api';
import { temAmbosModulos } from '$lib/server/auth/admin-modulos';

export const POST: RequestHandler = async ({ cookies, locals, url }) => {
	const u = requireAdmin(locals);
	if (u instanceof Response) return u;

	const permitidos = u.modulosAdmin ?? { escalas: true, gise: true };
	if (!temAmbosModulos(permitidos)) {
		return forbidden('Esta conta não tem os dois módulos liberados para alternar.');
	}

	const rawAdminModulo = cookies.get('admin_modulo');
	const novoModulo = rawAdminModulo === 'gise' ? 'escalas' : 'gise';

	cookies.set('admin_modulo', novoModulo, cookieOptions(url));

	const redirectUrl = obterRotaBemVindo(u, novoModulo);

	return json({ success: true, redirect: redirectUrl });
};
