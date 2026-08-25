/**
 * POST /api/auth/solicitar-verificacao-email-pessoal
 *
 * Envia um código de 6 dígitos para o e-mail pessoal informado, para que o
 * usuário possa confirmá-lo como canal secundário de recuperação de senha.
 *
 * Requer sessão ativa (não é rota pública).
 */

import { json } from '@sveltejs/kit';
import { and, gt, count, eq } from 'drizzle-orm';
import { getDB } from '$lib/db';
import { timestampSqliteBrasilia } from '$lib/db/core';
import { gerarCodigo2FA, criarDesafio2FA } from '$lib/auth';
import { enviarCodigoEmailPessoal } from '$lib/server/email';
import { mascararEmail } from '$lib/server/auth/auth-flow';
import { doisFatoresTokens } from '$lib/server/schema';
import {
	exigirSenhaParaTrocaEmailPessoal,
	SENHA_ATUAL_JANELA_MIN
} from '$lib/server/auth/email-pessoal-guard';
import {
	requireAuth,
	badRequest,
	forbidden,
	rateLimited,
	serverError,
	validateBody
} from '$lib/server/api';
import { solicitarVerificacaoEmailSchema } from '$lib/schemas';
import type { RequestHandler } from './$types';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const POST: RequestHandler = async ({ request, platform, locals }) => {
	const u = requireAuth(locals);
	if (u instanceof Response) return u;

	const v = await validateBody(request, solicitarVerificacaoEmailSchema);
	if (!v.ok) return v.response;
	const email = v.data.email;
	const senha = v.data.senha;

	if (!EMAIL_REGEX.test(email)) return badRequest('E-mail inválido');

	// E-mail pessoal deve ser diferente do e-mail institucional
	if (u.email && email.toLowerCase() === u.email.toLowerCase()) {
		return badRequest('O e-mail pessoal deve ser diferente do e-mail institucional');
	}

	const db = getDB(platform);

	// TROCA de e-mail pessoal (usuário que já tem um cadastrado): exige a
	// reinserção da senha — uma sessão esquecida/roubada não basta para
	// redirecionar o canal de recuperação de senha. Isentos: 1º cadastro (sem
	// e-mail anterior) e `primeiro_acesso` (a senha ainda está sendo definida
	// em /alterar-senha).
	//
	// L-1 da auditoria 2026-07-10: a regra vale para TODAS as sessões (antes,
	// só policiais — admins trocavam sem senha) e a verificação é throttled por
	// usuário (mesmo orçamento do /alterar-senha), fechando o brute-force
	// online da senha por este endpoint com sessão roubada.
	const pepper = (platform?.env as Env | undefined)?.PASSWORD_PEPPER?.trim() || undefined;
	const guarda = await exigirSenhaParaTrocaEmailPessoal(db, u, senha, pepper);
	if (!guarda.ok) {
		if (guarda.erro === 'senha_ausente') {
			return badRequest('Informe sua senha de acesso para trocar o e-mail pessoal.');
		}
		if (guarda.erro === 'bloqueado') {
			return rateLimited(
				`Muitas tentativas de senha incorretas. Tente novamente em ${SENHA_ATUAL_JANELA_MIN} minutos.`
			);
		}
		return forbidden('Senha incorreta.');
	}

	// Normaliza para baixo o e-mail antes de bindar — verificação faz lookup
	// case-insensitive, então armazenar normalizado evita falso-mismatch
	// quando o usuário digitar variando maiúsculas/minúsculas no confirm.
	const emailNormalizado = email.toLowerCase();

	// Rate limit dedicado ao tipo `verificacao_email` (I-2 da auditoria): canal
	// separado de `assinatura` (que cobre signing). Antes os dois compartilhavam
	// o mesmo contador — disparar pedidos de verificação de e-mail bloqueava
	// solicitações legítimas de código para assinatura.
	// `created_at` guarda horário de BRASÍLIA no formato do SQLite
	// (`datetime('now','-3 hours')`). Comparar com `toISOString()` deixava o
	// contador sempre em zero — o limite existia e nunca disparava.
	const windowStart = timestampSqliteBrasilia(Date.now() - 10 * 60 * 1000);
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
	// `bindExtra = tipo + email` (I-1 da auditoria): o hash do código no banco
	// inclui o endereço destino — `confirmar-verificacao` só valida passando o
	// MESMO email, impedindo submeter código de email_A com email_B no body.
	// O `tipo` entra no binding porque `usuario_id` colide entre tabelas
	// (administradores.id vs policiais.id): sem ele, um policial de id N
	// poderia, em tese, confirmar o desafio criado por um admin de id N.
	const desafioId = await criarDesafio2FA(
		db,
		'verificacao_email',
		u.id,
		codigo,
		`${u.tipo}\x1f${emailNormalizado}`
	);

	try {
		await enviarCodigoEmailPessoal(email, codigo, u.nome, platform);
	} catch (err) {
		return serverError('[verificacao-email-pessoal] Falha ao enviar e-mail', err);
	}

	return json({ desafioId, emailMascarado: mascararEmail(email) });
};
