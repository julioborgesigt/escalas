/**
 * POST /api/auth/verificar-2fa
 *
 * Verifica o código 2FA enviado por e-mail e cria a sessão do usuário.
 */

import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { getDB } from '$lib/db';
import { criarSessao, verificarDesafio2FA } from '$lib/auth';
import { policiais, administradores } from '$lib/server/schema';
import { eq } from 'drizzle-orm';
import { cookieOptions } from '$lib/server/auth-flow';
import { apiError, ErrorCode, badRequest, notFound, forbidden } from '$lib/server/api';

export const POST = async ({ platform, request, cookies, url }: RequestEvent) => {
	const db = getDB(platform);
	const body = await request.json().catch(() => ({}));
	const { desafioId, codigo } = body;

	if (!desafioId || !codigo) {
		return badRequest('Dados inválidos');
	}

	const resultado = await verificarDesafio2FA(db, desafioId, String(codigo), ['policial', 'admin']);

	if (resultado === 'expirado') {
		// Mantém status 401 + flag legada `expirado` para o front diferenciar
		// até a próxima major do contrato. O ErrorCode novo (AUTH_REQUIRED)
		// também identifica o caso para consumidores que migrarem.
		return json(
			{
				error: 'Código expirado. Faça login novamente.',
				status: 401,
				errorType: ErrorCode.AUTH_REQUIRED,
				expirado: true
			},
			{ status: 401 }
		);
	}
	if (resultado === 'esgotado') {
		return json(
			{
				error: 'Muitas tentativas incorretas. Faça login novamente.',
				status: 429,
				errorType: ErrorCode.RATE_LIMIT,
				esgotado: true
			},
			{ status: 429 }
		);
	}
	if (!resultado) {
		return apiError(
			'Código inválido. Verifique e tente novamente.',
			401,
			ErrorCode.AUTH_REQUIRED
		);
	}

	const { tipo, usuarioId } = resultado;

	// Verificar se o usuário ainda está ativo e buscar primeiro_acesso
	let primeiroAcesso: boolean;
	if (tipo === 'admin') {
		const admin = await db
			.select()
			.from(administradores)
			.where(eq(administradores.id, usuarioId))
			.get();
		if (!admin) return notFound('Usuário');
		primeiroAcesso = admin.primeiro_acesso === 1;
	} else {
		const policial = await db
			.select()
			.from(policiais)
			.where(eq(policiais.id, usuarioId))
			.get();
		if (!policial || policial.ativo === 0) {
			return forbidden('Usuário inativo');
		}
		primeiroAcesso = policial.primeiro_acesso === 1;
	}

	const token = await criarSessao(db, tipo as 'policial' | 'admin', usuarioId);
	cookies.set('session_token', token, cookieOptions(url));

	return json({ success: true, primeiro_acesso: primeiroAcesso });
};
