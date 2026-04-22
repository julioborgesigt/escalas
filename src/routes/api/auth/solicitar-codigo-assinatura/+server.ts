import { json } from '@sveltejs/kit';
import { getDB } from '$lib/db';
import { policiais, administradores, doisFatoresTokens } from '$lib/server/schema';
import { eq, and, gt, count } from 'drizzle-orm';
import { gerarCodigo2FA, criarDesafio2FA } from '$lib/auth';
import { enviarCodigo2FA } from '$lib/server/email';
import { logger } from '$lib/server/logger';
import type { RequestHandler } from './$types';

const MAX_TENTATIVAS_USUARIO = 5;
const JANELA_USUARIO_MINUTOS = 60;

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

		// Rate limit por usuário (máx 5 códigos na última hora)
		const windowUsuario = new Date(Date.now() - JANELA_USUARIO_MINUTOS * 60 * 1000).toISOString();
		const [codeCount] = await db
			.select({ n: count() })
			.from(doisFatoresTokens)
			.where(
				and(
					eq(doisFatoresTokens.tipo, 'assinatura'),
					eq(doisFatoresTokens.usuario_id, u.id),
					gt(doisFatoresTokens.created_at, windowUsuario)
				)
			);

		if ((codeCount?.n ?? 0) >= MAX_TENTATIVAS_USUARIO) {
			return json(
				{ error: `Muitas solicitações. Tente novamente em ${JANELA_USUARIO_MINUTOS} minutos.` },
				{ status: 429 }
			);
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

function mascararEmail(email: string): string {
	const at = email.indexOf('@');
	if (at <= 0) return email;
	const local = email.slice(0, at);
	const domain = email.slice(at + 1);
	let masked: string;
	if (local.length === 1) {
		masked = local;
	} else if (local.length === 2) {
		masked = local[0] + '*';
	} else {
		const showStart = Math.min(2, Math.floor(local.length / 2));
		masked = local.slice(0, showStart) + '*'.repeat(local.length - showStart - 1) + local[local.length - 1];
	}
	return masked + '@' + domain;
}
