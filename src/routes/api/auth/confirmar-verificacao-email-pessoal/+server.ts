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
import { requireAuth, badRequest, forbidden, rateLimited, validateBody } from '$lib/server/api';
import { confirmarVerificacaoEmailSchema } from '$lib/schemas';
import type { RequestHandler } from './$types';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const POST: RequestHandler = async ({ request, platform, locals }) => {
	const u = requireAuth(locals);
	if (u instanceof Response) return u;

	const v = await validateBody(request, confirmarVerificacaoEmailSchema);
	if (!v.ok) return v.response;
	const { desafioId, codigo, email } = v.data;

	if (!EMAIL_REGEX.test(email)) return badRequest('E-mail inválido');

	const db = getDB(platform);
	const emailNormalizado = email.toLowerCase();

	// Tipo dedicado `verificacao_email` (I-2): se o desafio veio do canal de
	// assinatura, é rejeitado aqui — fecha confused-deputy.
	// `bindExtra = tipo + emailNormalizado` (I-1): o hash precisa bater contra
	// o MESMO e-mail que recebeu o OTP e o MESMO tipo de usuário que criou o
	// desafio (usuario_id colide entre administradores e policiais). Se o
	// usuário trocar o `email` no body entre solicitar e confirmar, ou um
	// desafio de admin for submetido por policial de mesmo id, o hash diverge
	// → 'Código inválido'.
	const resultado = await verificarDesafio2FA(
		db,
		desafioId,
		codigo,
		['verificacao_email'],
		`${u.tipo}\x1f${emailNormalizado}`
	);

	if (resultado === 'expirado') return badRequest('Código expirado. Solicite um novo código.');
	if (resultado === 'esgotado') {
		return rateLimited('Muitas tentativas incorretas. Solicite um novo código.');
	}
	if (!resultado) return badRequest('Código inválido');

	// Garante que o token pertence ao usuário logado
	if (resultado.usuarioId !== u.id) return forbidden('Token inválido');

	// Persiste o e-mail pessoal verificado (normalizado).
	if (u.tipo === 'admin') {
		await db
			.update(administradores)
			.set({ email_pessoal: emailNormalizado, email_pessoal_verificado: 1 })
			.where(eq(administradores.id, u.id));
	} else {
		await db
			.update(policiais)
			.set({ email_pessoal: emailNormalizado, email_pessoal_verificado: 1 })
			.where(eq(policiais.id, u.id));
	}

	return json({ ok: true });
};
