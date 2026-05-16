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
import type { RequestHandler } from './$types';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const POST: RequestHandler = async ({ request, platform, locals }) => {
	const u = locals.usuario;
	if (!u) return json({ error: 'Não autorizado' }, { status: 401 });

	const body = await request.json().catch(() => null);
	const desafioId: string = body?.desafioId ?? '';
	const codigo: string = String(body?.codigo ?? '');
	const email: string = body?.email?.trim() ?? '';

	if (!desafioId || !codigo || !email || !EMAIL_REGEX.test(email)) {
		return json({ error: 'Dados inválidos' }, { status: 400 });
	}

	const db = getDB(platform);

	const resultado = await verificarDesafio2FA(db, desafioId, codigo, ['assinatura']);

	if (resultado === 'expirado') {
		return json({ error: 'Código expirado. Solicite um novo código.' }, { status: 400 });
	}
	if (resultado === 'esgotado') {
		return json({ error: 'Muitas tentativas incorretas. Solicite um novo código.' }, { status: 429 });
	}
	if (!resultado) {
		return json({ error: 'Código inválido' }, { status: 400 });
	}

	// Garante que o token pertence ao usuário logado
	if (resultado.usuarioId !== u.id) {
		return json({ error: 'Token inválido' }, { status: 403 });
	}

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
