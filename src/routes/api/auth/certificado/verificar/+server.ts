import { json } from '@sveltejs/kit';
import { eq, and } from 'drizzle-orm';
import { getDB } from '$lib/db';
import { criarSessao } from '$lib/auth';
import { doisFatoresTokens, policiais } from '$lib/server/schema';
import {
	badRequest,
	unauthorized,
	forbidden,
	rateLimited,
	serverError,
	ErrorCode,
	apiError
} from '$lib/server/api';
import { checkRateLimit, recordAttempt, cookieOptions } from '$lib/server/auth-flow';
import { extrairDadosCertificado } from '$lib/server/pdf-signing';
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

	// Extrair CPF e nome do certificado no CMS
	let nome: string;
	let cpf: string;
	try {
		({ nome, cpf } = extrairDadosCertificado(cmsBase64));
	} catch (err) {
		await recordAttempt(db, ip, false);
		logger.warn('[cert-login] Falha ao extrair dados do certificado', {
			error: err instanceof Error ? err.message : String(err)
		});
		return badRequest('Não foi possível processar o certificado digital. Verifique o Token A3.');
	}

	const cpfLimpo = limparCPF(cpf);
	if (cpfLimpo.length !== 11) {
		await recordAttempt(db, ip, false);
		return badRequest('CPF não encontrado no certificado ou formato inválido.');
	}

	// Validar cadeia ICP-Brasil (se trust store disponível)
	const trustStore = loadTrustStore();
	if (trustStore.disponivel) {
		try {
			const der = forge.util.decode64(cmsBase64);
			const asn1 = forge.asn1.fromDer(der);
			const p7 = forge.pkcs7.messageFromAsn1(asn1);
			const certs = (p7 as unknown as { certificates: forge.pki.Certificate[] }).certificates;

			if (certs.length > 0) {
				forge.pki.verifyCertificateChain(trustStore.caStore, certs);
			}
		} catch (err) {
			const env = platform?.env as Record<string, string | undefined> | undefined;
			const strictMode =
				env?.ICP_BRASIL_TRUST_STORE_REQUIRED &&
				/^(1|true|yes|on)$/i.test(env.ICP_BRASIL_TRUST_STORE_REQUIRED.trim());

			if (strictMode) {
				await recordAttempt(db, ip, false);
				logger.warn('[cert-login] Cadeia ICP-Brasil inválida (modo estrito)', {
					cpf: cpfLimpo.slice(0, 3) + '***',
					error: err instanceof Error ? err.message : String(err)
				});
				return apiError(
					'Certificado não pertence a uma cadeia ICP-Brasil válida.',
					422,
					ErrorCode.VALIDATION
				);
			}
			logger.warn('[cert-login] Cadeia ICP-Brasil indisponível ou inválida (modo permissivo)', {
				error: err instanceof Error ? err.message : String(err)
			});
		}
	}

	// Verificar validade do certificado (datas)
	try {
		const der = forge.util.decode64(cmsBase64);
		const asn1 = forge.asn1.fromDer(der);
		const p7 = forge.pkcs7.messageFromAsn1(asn1);
		const cert = (p7 as unknown as { certificates: forge.pki.Certificate[] }).certificates[0];
		if (cert) {
			const now = new Date();
			if (now < cert.validity.notBefore || now > cert.validity.notAfter) {
				await recordAttempt(db, ip, false);
				return badRequest('Certificado digital expirado ou ainda não válido.');
			}
		}
	} catch {
		// Não bloquear se falhar a leitura da validade — a extração do CPF já funcionou
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
