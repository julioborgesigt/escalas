import { json } from '@sveltejs/kit';
import { getDB } from '$lib/db';
import {
	executeLoginPassword,
	LOGIN_WINDOW_MINUTES
} from '$lib/server/auth-login-flow';
import { cookieOptionsLogin } from '$lib/server/login-helpers';
import { loginSchema } from '$lib/schemas';
import type { RequestHandler } from './$types';

const cookieOptions = cookieOptionsLogin;

export const POST: RequestHandler = async ({ platform, request, cookies, url, getClientAddress }) => {
	const db = getDB(platform);
	const ip = getClientAddress();
	const body = await request.json();

	const parsed = loginSchema.safeParse(body);
	if (!parsed.success) {
		return json({ error: parsed.error.issues[0].message }, { status: 400 });
	}

	const { matricula, senha, tipo } = parsed.data;

	const result = await executeLoginPassword(
		db,
		ip,
		platform,
		{ matricula, senha, tipo },
		{}
	);

	if (result.outcome === 'rate_limited') {
		return json(
			{ error: `Muitas tentativas de login. Tente novamente em ${LOGIN_WINDOW_MINUTES} minutos.` },
			{ status: 429 }
		);
	}

	if (result.outcome === 'error') {
		return json({ error: result.message }, { status: result.httpStatus });
	}

	if (result.outcome === '2fa') {
		return json({
			pendente2FA: true,
			desafioId: result.desafioId,
			nome: result.nome,
			primeiro_acesso: result.primeiro_acesso,
			emailMascarado: result.emailMascarado
		});
	}

	cookies.set('session_token', result.token, cookieOptions(url));
	return json({
		success: true,
		primeiro_acesso: result.primeiro_acesso,
		nome: result.nome
	});
};
