/**
 * Envia o código 2FA da cerimônia de assinatura para o e-mail do próprio usuário.
 *
 * Cada chamada dispara um E-MAIL e cria um desafio, e é isso que o teto por IP
 * protege: sem ele a rota é vetor de e-mail bombing contra o titular e de
 * exaustão da quota do provedor — que derrubaria junto o 2FA de login e a
 * recuperação de senha de todo mundo, porque saem pelo mesmo canal.
 *
 * Não aceita id de terceiro: o destino é sempre o e-mail de `locals.usuario`.
 * É por isso que ela está declarada como dispensada de autorização no
 * `guard-autorizacao.mjs` — não há segundo sujeito a autorizar.
 */
import { json } from '@sveltejs/kit';
import { getDB } from '$lib/db';
import { policiais, administradores } from '$lib/server/schema';
import { eq } from 'drizzle-orm';
import { gerarCodigo2FA, criarDesafio2FA } from '$lib/auth';
import { enviarCodigo2FA } from '$lib/server/email';
import { logger } from '$lib/server/logger';
import { mascararEmail } from '$lib/server/auth/auth-flow';
import {
	contarRecoveryAttempts,
	registrarRecoveryAttempt
} from '$lib/server/auth/recovery-rate-limit';
import { requireAuth, badRequest, rateLimited, serverError } from '$lib/server/api';
import type { RequestHandler } from './$types';
import { mensagemDeErro } from '$lib/utils/erro';

// Teto por IP do envio do código 2FA de assinatura: cada chamada dispara um
// e-mail e cria um desafio. Sem teto vira vetor de e-mail bombing e de exaustão
// da quota do provedor (DoS dos e-mails 2FA/reset de todos os usuários).
const CODIGO_ASSINATURA_MAX = 5;
const CODIGO_ASSINATURA_WINDOW_MIN = 15;

export const POST: RequestHandler = async ({ platform, locals, getClientAddress }) => {
	try {
		const u = requireAuth(locals);
		if (u instanceof Response) return u;

		const db = getDB(platform);
		const ip = getClientAddress();

		// Rate-limit por IP (fail-open em erro de infra).
		try {
			const { blocked } = await contarRecoveryAttempts(
				db,
				ip,
				'solicitar_codigo_assinatura',
				CODIGO_ASSINATURA_WINDOW_MIN,
				CODIGO_ASSINATURA_MAX
			);
			if (blocked) {
				return rateLimited('Muitas solicitações de código. Aguarde alguns minutos.');
			}
		} catch (err) {
			logger.error('[Assinatura 2FA] Falha no rate-limit (fail-open)', {
				error: mensagemDeErro(err)
			});
		}

		// Recuperar o usuário do DB para confirmar o e-mail
		let email: string | null = null;
		if (u.tipo === 'policial') {
			const row = await db
				.select({ email: policiais.email })
				.from(policiais)
				.where(eq(policiais.id, u.id))
				.get();
			email = row?.email ?? null;
		} else {
			const row = await db
				.select({ email: administradores.email })
				.from(administradores)
				.where(eq(administradores.id, u.id))
				.get();
			email = row?.email ?? null;
		}

		if (!email) {
			logger.warn('[Assinatura 2FA] Email não encontrado', { usuarioId: u.id, tipo: u.tipo });
			return badRequest('Você não possui um e-mail cadastrado. Contate o administrador.');
		}

		// Conta a solicitação para o teto por IP só após confirmar que há e-mail a
		// enviar. Fail-open: erro de registro não impede o envio.
		try {
			await registrarRecoveryAttempt(db, ip, 'solicitar_codigo_assinatura');
		} catch (err) {
			logger.error('[Assinatura 2FA] Falha ao registrar tentativa (fail-open)', {
				error: mensagemDeErro(err)
			});
		}

		const codigo = gerarCodigo2FA();
		const desafioId = await criarDesafio2FA(db, 'assinatura', u.id, codigo);

		const emailJob = enviarCodigo2FA(email, codigo, u.nome, platform).catch((err) => {
			logger.error('[Assinatura 2FA] Falha ao enviar e-mail', {
				error: mensagemDeErro(err)
			});
		});
		platform?.ctx?.waitUntil(emailJob);

		return json({
			success: true,
			desafioId,
			emailMascarado: mascararEmail(email)
		});
	} catch (err) {
		return serverError('[Assinatura 2FA] Erro crítico no handler', err);
	}
};
