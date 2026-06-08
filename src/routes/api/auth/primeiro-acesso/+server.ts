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
import { policiais } from '$lib/server/schema';
import { and, eq } from 'drizzle-orm';
import { contarRecoveryAttempts, registrarRecoveryAttempt } from '$lib/server/recovery-rate-limit';
import { serverError, validateBody } from '$lib/server/api';
import { primeiroAcessoSchema } from '$lib/schemas';
import { resolverAppOrigin } from '$lib/server/app-origin';
import { logger } from '$lib/server/logger';

const MAX_TENTATIVAS_IP = 5;
const JANELA_IP_MINUTOS = 15;

export const POST: RequestHandler = async ({ platform, request, url, getClientAddress }) => {
	const db = getDB(platform);
	const ip = getClientAddress();
	const v = await validateBody(request, primeiroAcessoSchema);
	if (!v.ok) return v.response;
	const { matricula } = v.data;

	// Resposta genérica para não revelar se a matrícula existe
	const respostaGenerica = json({
		ok: true,
		message:
			'Se a matrícula estiver cadastrada com e-mail e for primeiro acesso, você receberá o link por e-mail.'
	});

	// Rate limit em recovery_attempts (isolado de login_attempts).
	const limite = await contarRecoveryAttempts(
		db,
		ip,
		'primeiro_acesso',
		JANELA_IP_MINUTOS,
		MAX_TENTATIVAS_IP
	);
	if (limite.blocked) {
		return respostaGenerica;
	}
	await registrarRecoveryAttempt(db, ip, 'primeiro_acesso');

	const policial = await db
		.select()
		.from(policiais)
		.where(and(eq(policiais.matricula, matricula.trim()), eq(policiais.ativo, 1)))
		.get();

	// Anti-enumeração: TODAS as respostas de pré-requisitos devolvem a mesma
	// resposta genérica de sucesso. Antes, ausência de e-mail era 422 com
	// mensagem específica — diferenciava "matrícula existe" de "não existe",
	// permitindo enumerar a base de policiais. A informação útil ("contate o
	// administrador") agora fica no log estruturado para o operador.
	if (!policial || policial.primeiro_acesso !== 1 || !policial.email) {
		if (policial && !policial.email) {
			logger.warn('[primeiro-acesso] matrícula sem e-mail cadastrado', {
				policial_id: policial.id
			});
		}
		return respostaGenerica;
	}

	const token = await criarTokenRedefinicao(db, 'policial', policial.id);
	const link = `${resolverAppOrigin(url, platform)}/redefinir-senha?token=${token}`;

	try {
		await enviarLinkPrimeiroAcesso(policial.email, policial.nome, link, platform);
	} catch (err) {
		return serverError(
			`[primeiro-acesso] Falha ao enviar e-mail (policial_id=${policial.id})`,
			err
		);
	}

	return respostaGenerica;
};
