import { json } from '@sveltejs/kit';
import { getDB } from '$lib/db';
import { policiais, administradores } from '$lib/server/schema';
import { eq } from 'drizzle-orm';
import { gerarCodigo2FA, criarDesafio2FA } from '$lib/auth';
import { enviarCodigo2FA } from '$lib/server/email';
import { logger } from '$lib/server/logger';
import { mascararEmail } from '$lib/server/auth-flow';
import { requireAuth, badRequest, serverError } from '$lib/server/api';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ platform, locals }) => {
	try {
		const u = requireAuth(locals);
		if (u instanceof Response) return u;

		const db = getDB(platform);

		// Recuperar o usuário do DB para confirmar o e-mail
		let email: string | null = null;
		if (u.tipo === 'policial') {
			const row = await db.select({ email: policiais.email }).from(policiais).where(eq(policiais.id, u.id)).get();
			email = row?.email ?? null;
		} else {
			const row = await db.select({ email: administradores.email }).from(administradores).where(eq(administradores.id, u.id)).get();
			email = row?.email ?? null;
		}

		if (!email) {
			logger.warn('[Assinatura 2FA] Email não encontrado', { usuarioId: u.id, tipo: u.tipo });
			return badRequest('Você não possui um e-mail cadastrado. Contate o administrador.');
		}

		const codigo = gerarCodigo2FA();
		const desafioId = await criarDesafio2FA(db, 'assinatura', u.id, codigo);

		try {
			await enviarCodigo2FA(email, codigo, u.nome, platform);
		} catch (err) {
			return serverError('[Assinatura 2FA] Falha ao enviar e-mail', err);
		}

		return json({
			success: true,
			desafioId,
			emailMascarado: mascararEmail(email)
		});
	} catch (err) {
		return serverError('[Assinatura 2FA] Erro crítico no handler', err);
	}
};
