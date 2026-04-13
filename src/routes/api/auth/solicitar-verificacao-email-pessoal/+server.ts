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
import { doisFatoresTokens } from '$lib/server/schema';
import type { RequestHandler } from './$types';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

export const POST: RequestHandler = async ({ request, platform, locals }) => {
	const u = locals.usuario;
	if (!u) return json({ error: 'Não autorizado' }, { status: 401 });

	const body = await request.json().catch(() => null);
	const email: string = body?.email?.trim() ?? '';

	if (!email || !EMAIL_REGEX.test(email)) {
		return json({ error: 'E-mail inválido' }, { status: 400 });
	}

	// E-mail pessoal deve ser diferente do e-mail institucional
	if (u.email && email.toLowerCase() === u.email.toLowerCase()) {
		return json(
			{ error: 'O e-mail pessoal deve ser diferente do e-mail institucional' },
			{ status: 400 }
		);
	}

	const db = getDB(platform);

	// Rate limit: máx 3 envios por usuário nos últimos 10 minutos
	const windowStart = new Date(Date.now() - 10 * 60 * 1000).toISOString();
	const [countResult] = await db
		.select({ n: count() })
		.from(doisFatoresTokens)
		.where(
			and(
				eq(doisFatoresTokens.tipo, 'assinatura'),
				eq(doisFatoresTokens.usuario_id, u.id),
				gt(doisFatoresTokens.created_at, windowStart)
			)
		);

	if ((countResult?.n ?? 0) >= 3) {
		return json(
			{ error: 'Muitas tentativas. Aguarde alguns minutos antes de solicitar um novo código.' },
			{ status: 429 }
		);
	}

	const codigo = gerarCodigo2FA();
	const desafioId = await criarDesafio2FA(db, 'assinatura', u.id, codigo);

	try {
		await enviarCodigoEmailPessoal(email, codigo, u.nome, platform);
	} catch {
		return json({ error: 'Falha ao enviar e-mail. Verifique o endereço informado.' }, { status: 500 });
	}

	return json({ desafioId, emailMascarado: mascararEmail(email) });
};
