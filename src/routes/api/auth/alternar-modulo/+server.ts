import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { obterRotaBemVindo } from '$lib/auth';
import { cookieOptionsLogin } from '$lib/server/auth-flow';
import { requireAdmin } from '$lib/server/api';

export const POST: RequestHandler = async ({ cookies, locals, url }) => {
	const u = requireAdmin(locals);
	if (u instanceof Response) return u;

	const rawAdminModulo = cookies.get('admin_modulo');
	const novoModulo = rawAdminModulo === 'gise' ? 'escalas' : 'gise';

	cookies.set('admin_modulo', novoModulo, cookieOptionsLogin(url));

	const redirectUrl = obterRotaBemVindo(u, novoModulo);

	return json({ success: true, redirect: redirectUrl });
};
