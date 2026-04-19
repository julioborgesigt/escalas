import { json } from '@sveltejs/kit';
import { getDB } from '$lib/db';
import { tentarLogin, cookieOptionsLogin } from '$lib/server/auth-flow';
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

	const result = await tentarLogin({
		db,
		ip,
		matricula,
		senha,
		tipo,
		platform
	});

	if (!result.sucesso && result.statusCode === 429) {
		return json({ error: result.erro }, { status: 429 });
	}

	if (!result.sucesso && 'pendente2FA' in result) {
		const p = result.pendente2FA;
		return json({
			pendente2FA: true,
			desafioId: p.desafioId,
			nome: p.nome,
			primeiro_acesso: p.primeiroAcesso,
			emailMascarado: p.emailMascarado
		});
	}

	if (!result.sucesso) {
		return json({ error: result.erro }, { status: result.statusCode });
	}

	cookies.set('session_token', result.token, cookieOptions(url));
	return json({
		success: true,
		primeiro_acesso: result.primeiroAcesso,
		nome: result.nome
	});
};
