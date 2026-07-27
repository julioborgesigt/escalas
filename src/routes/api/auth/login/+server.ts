import { json } from '@sveltejs/kit';
import { getDB } from '$lib/db';
import { tentarLogin, cookieOptions } from '$lib/server/auth-flow';
import { loginSchema } from '$lib/schemas';
import { apiError, ErrorCode, badRequest, rateLimited } from '$lib/server/api';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({
	platform,
	request,
	cookies,
	url,
	getClientAddress
}) => {
	const db = getDB(platform);
	const ip = getClientAddress();
	const body = await request.json().catch(() => null);
	if (!body || typeof body !== 'object') return badRequest('Body JSON inválido');

	const parsed = loginSchema.safeParse(body);
	if (!parsed.success) return badRequest(parsed.error.issues[0].message);

	const { matricula, senha, tipo } = parsed.data;

	const result = await tentarLogin({
		db,
		ip,
		matricula,
		senha,
		tipo,
		platform
	});

	if (!result.sucesso && result.statusCode === 429) return rateLimited(result.erro);

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
		// tentarLogin pode devolver 400 (validação), 401 (credenciais inválidas),
		// 403 (sem e-mail para o 2º fator — fail-closed A1), 429 (rate-limit, já
		// tratado acima) ou 500 (interno).
		const code =
			result.statusCode === 401
				? ErrorCode.AUTH_REQUIRED
				: result.statusCode === 403
					? ErrorCode.FORBIDDEN
					: result.statusCode === 500
						? ErrorCode.INTERNAL
						: ErrorCode.VALIDATION;
		return apiError(result.erro, result.statusCode, code);
	}

	cookies.set('session_token', result.token, cookieOptions(url));
	return json({
		success: true,
		primeiro_acesso: result.primeiroAcesso,
		nome: result.nome
	});
};
