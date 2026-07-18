import { json } from '@sveltejs/kit';
import { eq, and } from 'drizzle-orm';
import { getDB, auditar, contextoDeEvento } from '$lib/db';
import { criarSessao, obterRotaBemVindo } from '$lib/auth';
import { administradores, doisFatoresTokens, policiais } from '$lib/server/schema';
import {
	badRequest,
	unauthorized,
	forbidden,
	rateLimited,
	ErrorCode,
	apiError,
	validateBody
} from '$lib/server/api';
import { certificadoVerificarSchema } from '$lib/schemas';
import { checkRateLimit, recordAttempt, cookieOptions } from '$lib/server/auth-flow';
import {
	verificarRespostaDesafioCertificado,
	verificarRevogacaoParaLogin
} from '$lib/server/cert-login';
import { loadTrustStore } from '$lib/server/icp-brasil/trust-store';
import { limparCPF } from '$lib/utils';
import { cpfKeys, indiceCPF } from '$lib/crypto/cpf-cripto';
import { logger } from '$lib/server/logger';
import forge from 'node-forge';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	const { platform, request, cookies, url, getClientAddress } = event;
	const db = getDB(platform);
	const ip = getClientAddress();

	const v = await validateBody(request, certificadoVerificarSchema);
	if (!v.ok) return v.response;
	const { desafioId, cmsBase64, comoAdmin, adminModulo } = v.data;

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
			'Não foi possível validar a assinatura do certificado. Refaça o login com o seu certificado digital.',
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

	// Revogação (OCSP) — M-1 da auditoria de segurança 2026-07-10: cadeia válida
	// não cobre e-CPF REVOGADO (token perdido/roubado reportado à AC) dentro da
	// validade. Política em `verificarRevogacaoParaLogin`: nega 'revoked' e
	// resposta não confiável; indisponibilidade do responder degrada para
	// 'unknown' e NÃO bloqueia (soft-fail auditado abaixo, em `metadados.ocsp`).
	const revogacao = await verificarRevogacaoParaLogin(verif.certificado);
	if (!revogacao.permitido) {
		await recordAttempt(db, ip, false);
		logger.warn('[cert-login] Certificado bloqueado pela checagem de revogação', {
			cpf: cpfLimpo.slice(0, 3) + '***',
			motivo: revogacao.motivo,
			revokedAt: revogacao.motivo === 'revogado' ? revogacao.revokedAt : undefined
		});
		return apiError(
			revogacao.motivo === 'revogado'
				? 'Certificado digital revogado junto à Autoridade Certificadora. Use matrícula e senha ou contate o administrador.'
				: 'Não foi possível confirmar o status de revogação do certificado (resposta OCSP não confiável). Tente novamente.',
			422,
			ErrorCode.VALIDATION
		);
	}
	if (revogacao.ocsp === 'unknown') {
		logger.warn('[cert-login] OCSP indisponível — login segue sem confirmação de revogação', {
			cpf: cpfLimpo.slice(0, 3) + '***',
			aviso: revogacao.aviso
		});
	}

	// Buscar policial pelo CPF. Como o `cpf` é cifrado em repouso (LGPD, GCM
	// não-determinístico), a busca usa o índice cego `cpf_index` quando a chave
	// está configurada; sem chave (fail-open), cai no `cpf` em texto.
	const { indexKey } = cpfKeys(platform?.env);
	const cpfFilter = indexKey
		? eq(policiais.cpf_index, await indiceCPF(cpfLimpo, indexKey))
		: eq(policiais.cpf, cpfLimpo);
	const policial = await db
		.select()
		.from(policiais)
		.where(and(cpfFilter, eq(policiais.ativo, 1)))
		.get();

	if (!policial) {
		await recordAttempt(db, ip, false);
		logger.info('[cert-login] CPF não encontrado ou policial inativo', {
			cpf: cpfLimpo.slice(0, 3) + '***'
		});
		return unauthorized('CPF não encontrado no sistema ou policial inativo.');
	}

	// Entrar no console de Admin Geral (aba "Administrador"): só se o CPF do
	// certificado tiver uma conta admin VINCULADA (`administradores.policial_id`)
	// — o mesmo vínculo que o login por senha usa. O certificado A3 substitui
	// senha + 2FA (é um fator mais forte: posse do token + PIN + cadeia ICP).
	if (comoAdmin) {
		const admin = await db
			.select()
			.from(administradores)
			.where(eq(administradores.policial_id, policial.id))
			.get();

		if (!admin) {
			await recordAttempt(db, ip, false);
			logger.info('[cert-login] Certificado sem conta de admin vinculada', {
				cpf: cpfLimpo.slice(0, 3) + '***'
			});
			return forbidden(
				'Este certificado não está vinculado a uma conta de Administrador Geral. Entre pela aba Policial ou use login e senha.'
			);
		}

		// Marcar desafio como usado (one-time use)
		await db
			.update(doisFatoresTokens)
			.set({ usado: 1 })
			.where(eq(doisFatoresTokens.id, desafio.id));
		await recordAttempt(db, ip, true);

		const token = await criarSessao(db, 'admin', admin.id);
		cookies.set('session_token', token, cookieOptions(url));

		const modulo = adminModulo ?? 'ambas';
		cookies.set('admin_modulo', modulo, cookieOptions(url));

		const { contexto, env } = contextoDeEvento(event);
		await auditar(
			db,
			{
				acao: 'login_certificado',
				usuario: { id: admin.id, nome: admin.nome, tipo: 'admin' },
				entidade: 'admin',
				entidade_id: admin.id,
				alvo_tipo: 'admin',
				alvo_id: admin.id,
				alvo_nome: admin.nome,
				detalhes: 'Login por certificado digital (ICP-Brasil) — console de administração',
				metadados: { via: 'certificado_a3', comoAdmin: true, ocsp: revogacao.ocsp },
				...contexto
			},
			{ env }
		);

		const primeiroAcesso = policial.primeiro_acesso === 1;
		const rota = obterRotaBemVindo(
			{ id: admin.id, tipo: 'admin', nome: admin.nome, primeiro_acesso: primeiroAcesso },
			modulo
		);
		return json({
			success: true,
			primeiro_acesso: primeiroAcesso,
			nome: admin.nome,
			redirect: primeiroAcesso ? '/alterar-senha' : rota
		});
	}

	// Marcar desafio como usado (one-time use)
	await db.update(doisFatoresTokens).set({ usado: 1 }).where(eq(doisFatoresTokens.id, desafio.id));

	await recordAttempt(db, ip, true);

	const token = await criarSessao(db, 'policial', policial.id);
	cookies.set('session_token', token, cookieOptions(url));

	const { contexto, env } = contextoDeEvento(event);
	await auditar(
		db,
		{
			acao: 'login_certificado',
			usuario: { id: policial.id, nome: policial.nome, tipo: 'policial' },
			entidade: 'policial',
			entidade_id: policial.id,
			alvo_tipo: 'policial',
			alvo_id: policial.id,
			alvo_nome: policial.nome,
			detalhes: 'Login por certificado digital (ICP-Brasil)',
			// `ocsp: 'unknown'` sinaliza login SEM confirmação de revogação
			// (responder indisponível) — rastreável na trilha para forense.
			metadados: { via: 'certificado_a3', ocsp: revogacao.ocsp },
			...contexto
		},
		{ env }
	);

	return json({
		success: true,
		primeiro_acesso: policial.primeiro_acesso === 1,
		nome: policial.nome
	});
};
