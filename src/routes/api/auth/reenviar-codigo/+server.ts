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
 * Rate-limit: o próprio desafioId é a prova de autenticidade (quem não passou
 * pela tela de login não tem um desafio válido). Cada resend invalida o desafio
 * anterior, limitando a janela de abuso naturalmente.
 */
import { json } from '@sveltejs/kit';
import { eq, and, gt } from 'drizzle-orm';
import { getDB } from '$lib/db';
import { criarDesafio2FA, gerarCodigo2FA } from '$lib/auth';
import { enviarCodigo2FA } from '$lib/server/email';
import { logger } from '$lib/server/logger';
import { administradores, policiais, doisFatoresTokens } from '$lib/server/schema';
import { mascararEmail } from '$lib/server/auth-flow';
import { badRequest, serverError } from '$lib/server/api';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, platform }) => {
	try {
		const db = getDB(platform);

		const body = await request.json().catch(() => null);
		if (!body || typeof body !== 'object') return badRequest('Body inválido');
		const { desafioId } = body as Record<string, unknown>;
		if (!desafioId || typeof desafioId !== 'string') return badRequest('desafioId inválido');

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
