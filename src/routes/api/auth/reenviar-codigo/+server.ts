/**
 * POST /api/auth/reenviar-codigo
 *
 * Reenvia o código 2FA de login (policial ou admin) dado um desafioId ainda
 * válido. Cria um novo desafio (novo código), invalida o antigo e retorna o
 * novo desafioId para o cliente atualizar seu estado.
 *
 * Só aceita desafios do tipo 'policial' ou 'admin' — não permite reenvio de
 * assinatura, reset ou verificação de e-mail pessoal por esta rota.
 *
 * Rate-limit: além de o desafioId ser a prova de autenticidade e de cada resend
 * invalidar o anterior, há teto por IP (recovery_attempts/'reenviar_codigo').
 * Cada reenvio dispara um e-mail ao usuário e cria um novo desafio (resetando o
 * contador de tentativas do 2FA), então sem teto seria vetor de e-mail bombing
 * e de reset infinito do brute-force do código.
 */
import { json } from '@sveltejs/kit';
import { eq, and, gt } from 'drizzle-orm';
import { getDB } from '$lib/db';
import { criarDesafio2FA, gerarCodigo2FA } from '$lib/auth';
import { enviarCodigo2FA } from '$lib/server/email';
import { logger } from '$lib/server/logger';
import { administradores, policiais, doisFatoresTokens } from '$lib/server/schema';
import { mascararEmail } from '$lib/server/auth/auth-flow';
import {
	contarRecoveryAttempts,
	registrarRecoveryAttempt
} from '$lib/server/auth/recovery-rate-limit';
import { badRequest, rateLimited, serverError, validateBody } from '$lib/server/api';
import { reenviarCodigoSchema } from '$lib/schemas';
import type { RequestHandler } from './$types';

// Teto por IP do reenvio de 2FA: cada reenvio envia e-mail e reseta o contador
// de tentativas do código. 5/15min é folgado para problemas de entrega de e-mail.
const REENVIAR_MAX = 5;
const REENVIAR_WINDOW_MIN = 15;

export const POST: RequestHandler = async ({ request, platform, getClientAddress }) => {
	try {
		const db = getDB(platform);
		const ip = getClientAddress();

		try {
			const { blocked } = await contarRecoveryAttempts(
				db,
				ip,
				'reenviar_codigo',
				REENVIAR_WINDOW_MIN,
				REENVIAR_MAX
			);
			if (blocked) return rateLimited('Muitos reenvios. Aguarde alguns minutos.');
		} catch (err) {
			logger.error('[reenviar-codigo] Falha no rate-limit (fail-open)', {
				error: err instanceof Error ? err.message : String(err)
			});
		}

		const v = await validateBody(request, reenviarCodigoSchema);
		if (!v.ok) return v.response;
		const { desafioId } = v.data;

		// Busca desafio original (deve existir, ser policial/admin, não expirado, não usado)
		const agora = new Date().toISOString();
		const desafio = await db
			.select()
			.from(doisFatoresTokens)
			.where(
				and(
					eq(doisFatoresTokens.desafio_id, desafioId),
					gt(doisFatoresTokens.expires_at, agora),
					eq(doisFatoresTokens.usado, 0)
				)
			)
			.get();

		if (!desafio || (desafio.tipo !== 'policial' && desafio.tipo !== 'admin')) {
			return badRequest('Código expirado ou inválido. Faça login novamente.');
		}

		// Busca e-mail do usuário
		let email: string | null = null;
		let nome = '';
		if (desafio.tipo === 'policial') {
			const row = await db
				.select({ email: policiais.email, nome: policiais.nome })
				.from(policiais)
				.where(eq(policiais.id, desafio.usuario_id))
				.get();
			email = row?.email ?? null;
			nome = row?.nome ?? '';
		} else {
			const row = await db
				.select({ email: administradores.email, nome: administradores.nome })
				.from(administradores)
				.where(eq(administradores.id, desafio.usuario_id))
				.get();
			email = row?.email ?? null;
			nome = row?.nome ?? '';
		}

		if (!email) return badRequest('E-mail não encontrado. Contate o administrador.');

		// Conta este reenvio para o teto por IP (só após confirmar que há e-mail a
		// enviar). Fail-open: erro de registro não impede o reenvio.
		try {
			await registrarRecoveryAttempt(db, ip, 'reenviar_codigo');
		} catch (err) {
			logger.error('[reenviar-codigo] Falha ao registrar tentativa (fail-open)', {
				error: err instanceof Error ? err.message : String(err)
			});
		}

		// Invalida o desafio antigo e cria um novo
		await db
			.update(doisFatoresTokens)
			.set({ usado: 1 })
			.where(eq(doisFatoresTokens.desafio_id, desafioId));

		const novoCodigo = gerarCodigo2FA();
		const novoDesafioId = await criarDesafio2FA(db, desafio.tipo, desafio.usuario_id, novoCodigo);

		// Envia e-mail em background — não bloqueia a resposta
		const emailJob = enviarCodigo2FA(email, novoCodigo, nome, platform).catch((err) => {
			logger.error('[reenviar-codigo] Falha ao reenviar e-mail', {
				error: err instanceof Error ? err.message : String(err)
			});
		});
		platform?.ctx?.waitUntil(emailJob);

		return json({ desafioId: novoDesafioId, emailMascarado: mascararEmail(email) });
	} catch (err) {
		return serverError('[reenviar-codigo] Erro crítico', err);
	}
};
