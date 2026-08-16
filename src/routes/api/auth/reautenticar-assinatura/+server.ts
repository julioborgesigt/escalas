/**
 * POST /api/auth/reautenticar-assinatura
 *
 * Confere a senha de acesso do usuário logado e abre a janela de ~10 min
 * que os POSTs de assinatura avançada exigem. Autosserviço: o recurso é a
 * própria sessão — não há segundo sujeito a autorizar. Sem matrícula no
 * corpo; a identidade vem do cookie.
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDB } from '$lib/db';
import { requireAuth, unauthorized, validateBody, apiError, ErrorCode } from '$lib/server/api';
import { reautenticarAssinaturaSchema } from '$lib/schemas';
import { abrirJanelaReauthAssinatura } from '$lib/server/assinatura/reauth';

export const POST: RequestHandler = async ({
	platform,
	locals,
	request,
	cookies,
	getClientAddress
}) => {
	const u = requireAuth(locals);
	if (u instanceof Response) return u;

	const sessaoToken = cookies.get('session_token');
	if (!sessaoToken) return unauthorized();

	const v = await validateBody(request, reautenticarAssinaturaSchema);
	if (!v.ok) return v.response;

	const db = getDB(platform);
	const env = platform?.env as Env | undefined;
	const r = await abrirJanelaReauthAssinatura(db, u, v.data.senha, sessaoToken, {
		ip: getClientAddress(),
		pepper: env?.PASSWORD_PEPPER?.trim() || undefined,
		env: {
			ADMIN_GERAL_LOGIN: env?.ADMIN_GERAL_LOGIN,
			ADMIN_GERAL_SENHA: env?.ADMIN_GERAL_SENHA,
			SUPER_ADMIN_LOGIN: env?.SUPER_ADMIN_LOGIN,
			SUPER_ADMIN_SENHA: env?.SUPER_ADMIN_SENHA
		}
	});
	if (!r.ok) return apiError(r.error, r.status, r.code ?? ErrorCode.AUTH_REQUIRED);
	return json({ reauthId: r.reauthId });
};
