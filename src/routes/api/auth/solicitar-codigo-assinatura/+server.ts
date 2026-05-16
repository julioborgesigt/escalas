import { json } from '@sveltejs/kit';
import { getDB } from '$lib/db';
import { policiais, administradores } from '$lib/server/schema';
import { eq } from 'drizzle-orm';
import { gerarCodigo2FA, criarDesafio2FA } from '$lib/auth';
import { enviarCodigo2FA } from '$lib/server/email';
import { logger } from '$lib/server/logger';
import { mascararEmail } from '$lib/server/auth-flow';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ platform, locals, url }) => {
	try {
		const db = getDB(platform);
		const u = locals.usuario;

		if (!u) {
			logger.error('[assinatura/2fa] Usuário ausente em locals.usuario', {
				path: url.pathname
			});
			return json({ error: 'Sessão inválida ou expirada. Faça login novamente.' }, { status: 401 });
		}

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
			return json({ error: 'Você não possui um e-mail cadastrado. Contate o administrador.' }, { status: 400 });
		}

		const codigo = gerarCodigo2FA();
		const desafioId = await criarDesafio2FA(db, 'assinatura', u.id, codigo);

		try {
			await enviarCodigo2FA(email, codigo, u.nome, platform);
		} catch (err: any) {
			logger.error('[Assinatura 2FA] Falha ao enviar e-mail', { error: err?.message });
			return json({ error: 'Falha no envio do código. Tente novamente.' }, { status: 500 });
		}

		return json({
			success: true,
			desafioId,
			emailMascarado: mascararEmail(email)
		});
	} catch (err: any) {
		logger.error('[Assinatura 2FA] Erro crítico no handler', { error: err?.message });
		return json({ error: 'Erro ao processar solicitação. Tente novamente.' }, { status: 500 });
	}
};
