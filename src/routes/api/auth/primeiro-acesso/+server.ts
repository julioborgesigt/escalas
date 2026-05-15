/**
 * POST /api/auth/primeiro-acesso
 *
 * Gera um link de primeiro acesso (token de redefinição de senha) e envia por
 * e-mail. Substitui o fluxo anterior de senha provisória em texto claro.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDB } from '$lib/db';
import { criarTokenRedefinicao } from '$lib/auth';
import { enviarLinkPrimeiroAcesso } from '$lib/server/email';
import { logger } from '$lib/server/logger';
import { policiais, loginAttempts } from '$lib/server/schema';
import { and, count, eq, gt } from 'drizzle-orm';

const MAX_TENTATIVAS_IP = 5;
const JANELA_IP_MINUTOS = 15;

export const POST: RequestHandler = async ({ platform, request, url, getClientAddress }) => {
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
		message: 'Se a matrícula estiver cadastrada com e-mail e for primeiro acesso, você receberá o link por e-mail.'
	});

	// Rate limit por IP
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

	const token = await criarTokenRedefinicao(db, 'policial', policial.id);
	const link = `${url.origin}/redefinir-senha?token=${token}`;

	try {
		await enviarLinkPrimeiroAcesso(policial.email, policial.nome, link, platform);
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
