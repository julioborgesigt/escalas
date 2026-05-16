/**
 * POST /api/auth/confirmar-verificacao-email-pessoal
 *
 * Confirma o código de verificação do e-mail pessoal e persiste o endereço
 * como canal secundário de recuperação de senha.
 *
 * Requer sessão ativa (não é rota pública).
 */

import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { getDB } from '$lib/db';
import { verificarDesafio2FA } from '$lib/auth';
import { administradores, policiais } from '$lib/server/schema';
import { requireAuth, badRequest, forbidden, rateLimited } from '$lib/server/api';
import type { RequestHandler } from './$types';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const POST: RequestHandler = async ({ request, platform, locals }) => {
	const u = requireAuth(locals);
	if (u instanceof Response) return u;

	const body = await request.json().catch(() => null);
	const desafioId: string = body?.desafioId ?? '';
	const codigo: string = String(body?.codigo ?? '');
	const email: string = body?.email?.trim() ?? '';

	if (!desafioId || !codigo || !email || !EMAIL_REGEX.test(email)) {
		return badRequest('Dados inválidos');
	}

	const db = getDB(platform);

	const resultado = await verificarDesafio2FA(db, desafioId, codigo, ['assinatura']);

	if (resultado === 'expirado') return badRequest('Código expirado. Solicite um novo código.');
	if (resultado === 'esgotado') {
		return rateLimited('Muitas tentativas incorretas. Solicite um novo código.');
	}
	if (!resultado) return badRequest('Código inválido');

	// Garante que o token pertence ao usuário logado
	if (resultado.usuarioId !== u.id) return forbidden('Token inválido');

	// Persiste o e-mail pessoal verificado
	if (u.tipo === 'admin') {
		await db
			.update(administradores)
			.set({ email_pessoal: email, email_pessoal_verificado: 1 })
			.where(eq(administradores.id, u.id));
	} else {
		await db
			.update(policiais)
			.set({ email_pessoal: email, email_pessoal_verificado: 1 })
			.where(eq(policiais.id, u.id));
	}

	return json({ ok: true });
};
