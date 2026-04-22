/**
 * POST /api/auth/primeiro-acesso
 *
 * Gera uma senha provisória e envia por e-mail para policiais com primeiro_acesso = 1.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDB } from '$lib/db';
import { hashSenha } from '$lib/auth';
import { enviarSenhaProvisoria } from '$lib/server/email';
import { logger } from '$lib/server/logger';
import { gerarSenhaProvisoria } from '$lib/server/provisional-password';
import { policiais, loginAttempts } from '$lib/server/schema';
import { and, count, eq, gt } from 'drizzle-orm';

const MAX_TENTATIVAS_IP = 5;
const JANELA_IP_MINUTOS = 15;

export const POST: RequestHandler = async ({ platform, request, getClientAddress }) => {
	const db = getDB(platform);
	const ip = getClientAddress();
	const body = await request.json().catch(() => ({}));
	const { matricula } = body;

	if (!matricula || typeof matricula !== 'string') {
		return json({ error: 'Matrícula inválida.' }, { status: 400 });
	}

	// Resposta genérica para não revelar se a matrícula existe
	const respostaGenerica = json({
		ok: true,
		message: 'Se a matrícula estiver cadastrada com e-mail e for primeiro acesso, você receberá a senha por e-mail.'
	});

	// Rate limit por IP: previne DoS de conta via ciclo de senha provisória.
	// Reusa `loginAttempts` (mesmo padrão de `solicitar-redefinicao`).
	const windowIp = new Date(Date.now() - JANELA_IP_MINUTOS * 60 * 1000).toISOString();
	const [ipCount] = await db
		.select({ n: count() })
		.from(loginAttempts)
		.where(and(eq(loginAttempts.ip, ip), gt(loginAttempts.attempted_at, windowIp)));

	if ((ipCount?.n ?? 0) >= MAX_TENTATIVAS_IP) {
		return respostaGenerica;
	}

	await db.insert(loginAttempts).values({ ip, success: 0 });

	const policial = await db
		.select()
		.from(policiais)
		.where(and(eq(policiais.matricula, matricula.trim()), eq(policiais.ativo, 1)))
		.get();

	if (!policial) return respostaGenerica;
	if (policial.primeiro_acesso !== 1) return respostaGenerica;
	if (!policial.email) {
		return json(
			{ error: 'Nenhum e-mail cadastrado para esta matrícula. Contate o administrador.' },
			{ status: 422 }
		);
	}

	const senhaProvisoria = gerarSenhaProvisoria();
	const senhaHash = await hashSenha(senhaProvisoria);

	await db.update(policiais).set({ senha: senhaHash }).where(eq(policiais.id, policial.id));

	try {
		await enviarSenhaProvisoria(policial.email, senhaProvisoria, policial.nome, platform);
	} catch (err) {
		logger.error('[primeiro-acesso] Falha ao enviar e-mail', {
			policial_id: policial.id,
			error: err instanceof Error ? err.message : String(err)
		});
		return json(
			{ error: 'Falha ao enviar e-mail. Tente novamente ou contate o administrador.' },
			{ status: 500 }
		);
	}

	return respostaGenerica;
};
