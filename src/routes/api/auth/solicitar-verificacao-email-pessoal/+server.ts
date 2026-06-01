/**
 * POST /api/auth/solicitar-verificacao-email-pessoal
 *
 * Envia um código de 6 dígitos para o e-mail pessoal informado, para que o
 * usuário possa confirmá-lo como canal secundário de recuperação de senha.
 *
 * Requer sessão ativa (não é rota pública).
 */

import { json } from '@sveltejs/kit';
import { eq, and, gt, count } from 'drizzle-orm';
import { getDB } from '$lib/db';
import { gerarCodigo2FA, criarDesafio2FA } from '$lib/auth';
import { enviarCodigoEmailPessoal } from '$lib/server/email';
import { mascararEmail } from '$lib/server/auth-flow';
import { doisFatoresTokens } from '$lib/server/schema';
import { requireAuth, badRequest, rateLimited, serverError } from '$lib/server/api';
import type { RequestHandler } from './$types';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const POST: RequestHandler = async ({ request, platform, locals }) => {
	const u = requireAuth(locals);
	if (u instanceof Response) return u;

	const body = await request.json().catch(() => null);
	const email: string = body?.email?.trim() ?? '';

	if (!email || !EMAIL_REGEX.test(email)) return badRequest('E-mail inválido');

	// E-mail pessoal deve ser diferente do e-mail institucional
	if (u.email && email.toLowerCase() === u.email.toLowerCase()) {
		return badRequest('O e-mail pessoal deve ser diferente do e-mail institucional');
	}

	const db = getDB(platform);

	// Normaliza para baixo o e-mail antes de bindar — verificação faz lookup
	// case-insensitive, então armazenar normalizado evita falso-mismatch
	// quando o usuário digitar variando maiúsculas/minúsculas no confirm.
	const emailNormalizado = email.toLowerCase();

	// Rate limit dedicado ao tipo `verificacao_email` (I-2 da auditoria): canal
	// separado de `assinatura` (que cobre signing). Antes os dois compartilhavam
	// o mesmo contador — disparar pedidos de verificação de e-mail bloqueava
	// solicitações legítimas de código para assinatura.
	const windowStart = new Date(Date.now() - 10 * 60 * 1000).toISOString();
	const [countResult] = await db
		.select({ n: count() })
		.from(doisFatoresTokens)
		.where(
			and(
				eq(doisFatoresTokens.tipo, 'verificacao_email'),
				eq(doisFatoresTokens.usuario_id, u.id),
				gt(doisFatoresTokens.created_at, windowStart)
			)
		);

	if ((countResult?.n ?? 0) >= 3) {
		return rateLimited(
			'Muitas tentativas. Aguarde alguns minutos antes de solicitar um novo código.'
		);
	}

	const codigo = gerarCodigo2FA();
	// `bindExtra = email` (I-1 da auditoria): o hash do código no banco
	// agora inclui o endereço destino. `confirmar-verificacao` só consegue
	// validar passando o MESMO email — impede submeter código de email_A
	// com email_B no body.
	const desafioId = await criarDesafio2FA(db, 'verificacao_email', u.id, codigo, emailNormalizado);

	try {
		await enviarCodigoEmailPessoal(email, codigo, u.nome, platform);
	} catch (err) {
		return serverError('[verificacao-email-pessoal] Falha ao enviar e-mail', err);
	}

	return json({ desafioId, emailMascarado: mascararEmail(email) });
};
