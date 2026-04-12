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

function cookieOptions(url: URL) {
	return {
		path: '/',
		httpOnly: true,
		sameSite: 'lax' as const,
		secure: url.protocol === 'https:',
		maxAge: 12 * 60 * 60
	};
}

export const POST = async ({ platform, request, cookies, url }: RequestEvent) => {
	const db = getDB(platform);
	const body = await request.json().catch(() => ({}));
	const { desafioId, codigo } = body;

	if (!desafioId || !codigo) {
		return json({ error: 'Dados inválidos' }, { status: 400 });
	}

	const resultado = await verificarDesafio2FA(db, desafioId, String(codigo));

	if (resultado === 'expirado') {
		return json(
			{ error: 'Código expirado. Faça login novamente.', expirado: true },
			{ status: 401 }
		);
	}
	if (resultado === 'esgotado') {
		return json(
			{ error: 'Muitas tentativas incorretas. Faça login novamente.', esgotado: true },
			{ status: 429 }
		);
	}
	if (!resultado) {
		return json({ error: 'Código inválido. Verifique e tente novamente.' }, { status: 401 });
	}

	const { tipo, usuarioId } = resultado;

	// Verificar se o usuário ainda está ativo e buscar primeiro_acesso
	let primeiroAcesso = false;
	if (tipo === 'admin') {
		const admin = await db
			.select()
			.from(administradores)
			.where(eq(administradores.id, usuarioId))
			.get();
		if (!admin) return json({ error: 'Usuário não encontrado' }, { status: 404 });
		primeiroAcesso = admin.primeiro_acesso === 1;
	} else {
		const policial = await db
			.select()
			.from(policiais)
			.where(eq(policiais.id, usuarioId))
			.get();
		if (!policial || policial.ativo === 0) {
			return json({ error: 'Usuário inativo' }, { status: 403 });
		}
		primeiroAcesso = policial.primeiro_acesso === 1;
	}

	const token = await criarSessao(db, tipo as 'policial' | 'admin', usuarioId);
	cookies.set('session_token', token, cookieOptions(url));

	return json({ success: true, primeiro_acesso: primeiroAcesso });
};
