import { json } from '@sveltejs/kit';
import { eq, and } from 'drizzle-orm';
import { getDB } from '$lib/db';
import { criarSessao } from '$lib/auth';
import { doisFatoresTokens, policiais } from '$lib/server/schema';
import { badRequest, unauthorized, rateLimited, ErrorCode, apiError } from '$lib/server/api';
import { checkRateLimit, recordAttempt, cookieOptions } from '$lib/server/auth-flow';
import { verificarRespostaDesafioCertificado } from '$lib/server/cert-login';
import { loadTrustStore } from '$lib/server/icp-brasil/trust-store';
import { limparCPF } from '$lib/utils';
import { logger } from '$lib/server/logger';
import forge from 'node-forge';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ platform, request, cookies, url, getClientAddress }) => {
	const db = getDB(platform);
	const ip = getClientAddress();

	const body = await request.json().catch(() => null);
	if (!body || typeof body !== 'object') return badRequest('Body JSON inválido');

	const { desafioId, cmsBase64 } = body as Record<string, unknown>;
	if (typeof desafioId !== 'string' || !desafioId) return badRequest('desafioId inválido');
	if (typeof cmsBase64 !== 'string' || !cmsBase64) return badRequest('cmsBase64 inválido');

	// Rate limit compartilhado com o fluxo normal de login
	const rateLimit = await checkRateLimit(db, ip);
	if (rateLimit.blocked) {
		return rateLimited('Muitas tentativas. Aguarde alguns minutos.');
	}

	// Buscar o desafio
	const desafio = await db
		.select()
		.from(doisFatoresTokens)
		.where(
			and(
				eq(doisFatoresTokens.desafio_id, desafioId),
				eq(doisFatoresTokens.tipo, 'login_certificado')
			)
		)
		.get();

	if (!desafio || desafio.usado === 1) {
		await recordAttempt(db, ip, false);
		return apiError('Desafio inválido ou já utilizado.', 401, ErrorCode.AUTH_REQUIRED);
	}
	if (new Date() > new Date(desafio.expires_at)) {
		await recordAttempt(db, ip, false);
		return apiError('Desafio expirado. Tente novamente.', 401, ErrorCode.AUTH_REQUIRED);
	}

	// Verificação criptográfica do desafio — fecha o bypass crítico. Confirma
	// (1) que o CMS tem assinatura válida sobre os SignedAttributes (prova de
	// posse da chave privada do Token A3) e (2) que o conteúdo assinado é o hash
	// do nonce DESTE desafio. `desafio.codigo` guarda exatamente o messageDigest
	// esperado (ver /iniciar). A identidade só é lida do certificado DEPOIS.
	const verif = await verificarRespostaDesafioCertificado(cmsBase64, desafio.codigo);
	if (!verif.ok) {
		await recordAttempt(db, ip, false);
		logger.warn('[cert-login] Verificação do desafio falhou', { motivo: verif.motivo });
		return apiError(
			'Não foi possível validar a assinatura do certificado. Refaça o login com o Token A3.',
			401,
			ErrorCode.AUTH_REQUIRED
		);
	}

	const cpfLimpo = limparCPF(verif.cpf);
	if (cpfLimpo.length !== 11) {
		await recordAttempt(db, ip, false);
		return badRequest('CPF não encontrado no certificado ou formato inválido.');
	}

	// Validade temporal do certificado (datas) — mensagem clara antes da cadeia.
	const agora = new Date();
	if (agora < verif.certificado.validity.notBefore || agora > verif.certificado.validity.notAfter) {
		await recordAttempt(db, ip, false);
		return badRequest('Certificado digital expirado ou ainda não válido.');
	}

	// Cadeia ICP-Brasil — OBRIGATÓRIA (fail-closed). É o que garante que o CPF
	// do subject pertence ao titular: uma AC ICP-Brasil só emite e-CPF após
	// validar a identidade. Sem isto, um certificado autoassinado com o CPF da
	// vítima (assinado com a chave do atacante) passaria pelos checks de
	// assinatura e nonce. Por isso aqui NÃO há mais "modo permissivo".
	const trustStore = loadTrustStore();
	if (!trustStore.disponivel) {
		await recordAttempt(db, ip, false);
		logger.error(
			'[cert-login] Trust store ICP-Brasil indisponível — login por certificado bloqueado'
		);
		return apiError(
			'Login por certificado indisponível no momento. Use matrícula e senha.',
			503,
			ErrorCode.UPSTREAM
		);
	}
	try {
		const der = forge.util.decode64(cmsBase64);
		const asn1 = forge.asn1.fromDer(der);
		const p7 = forge.pkcs7.messageFromAsn1(asn1);
		const certs = (p7 as unknown as { certificates: forge.pki.Certificate[] }).certificates;
		// Lança se a cadeia não terminar numa raiz/intermediária confiável.
		forge.pki.verifyCertificateChain(trustStore.caStore, certs);
	} catch (err) {
		await recordAttempt(db, ip, false);
		logger.warn('[cert-login] Cadeia ICP-Brasil inválida', {
			cpf: cpfLimpo.slice(0, 3) + '***',
			error: err instanceof Error ? err.message : String(err)
		});
		return apiError(
			'Certificado não pertence a uma cadeia ICP-Brasil válida.',
			422,
			ErrorCode.VALIDATION
		);
	}

	// Buscar policial pelo CPF
	const policial = await db
		.select()
		.from(policiais)
		.where(and(eq(policiais.cpf, cpfLimpo), eq(policiais.ativo, 1)))
		.get();

	if (!policial) {
		await recordAttempt(db, ip, false);
		logger.info('[cert-login] CPF não encontrado ou policial inativo', {
			cpf: cpfLimpo.slice(0, 3) + '***'
		});
		return unauthorized('CPF não encontrado no sistema ou policial inativo.');
	}

	// Marcar desafio como usado (one-time use)
	await db
		.update(doisFatoresTokens)
		.set({ usado: 1 })
		.where(eq(doisFatoresTokens.id, desafio.id));

	await recordAttempt(db, ip, true);

	const token = await criarSessao(db, 'policial', policial.id);
	cookies.set('session_token', token, cookieOptions(url));

	return json({
		success: true,
		primeiro_acesso: policial.primeiro_acesso === 1,
		nome: policial.nome
	});
};
