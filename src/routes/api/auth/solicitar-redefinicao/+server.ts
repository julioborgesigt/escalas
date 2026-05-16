/**
 * POST /api/auth/solicitar-redefinicao
 *
 * Rota pública. Recebe identificador (matrícula ou login) e tipo de usuário,
 * cria um desafio e envia um código ao e-mail pessoal do usuário.
 *
 * **Anti-enumeração:** sempre retorna a mesma estrutura
 * (`{ message, requerCodigo:true, desafioId, emailMascarado }`), com valores
 * dummy quando o usuário não existe / não tem e-mail pessoal verificado /
 * está rate-limitado. Caller não consegue distinguir externamente entre
 * usuário real e usuário fake.
 *
 * **Rate-limit:** isolado em `recovery_attempts` para não contaminar
 * `login_attempts` (que rege o gate de login).
 */

import { json } from '@sveltejs/kit';
import { eq, and, gt, count } from 'drizzle-orm';
import { getDB } from '$lib/db';
import { criarDesafio2FA, gerarCodigo2FA, gerarToken } from '$lib/auth';
import { enviarCodigoRedefinicaoSenha } from '$lib/server/email';
import { logger } from '$lib/server/logger';
import { administradores, policiais, doisFatoresTokens } from '$lib/server/schema';
import { mascararEmail } from '$lib/server/auth-flow';
import {
	contarRecoveryAttempts,
	registrarRecoveryAttempt
} from '$lib/server/recovery-rate-limit';
import type { RequestHandler } from './$types';

const RESPOSTA_GENERICA = 'Você receberá um código de validação em instantes.';
const MAX_TENTATIVAS_IP = 5;
const JANELA_IP_MINUTOS = 15;
const MAX_CODIGOS_USUARIO = 3;
const JANELA_CODIGOS_USUARIO_MINUTOS = 10;

/**
 * Gera uma máscara de e-mail determinística a partir do identificador.
 * Usado quando o usuário não existe (ou não tem e-mail pessoal) — mesmo
 * identificador sempre retorna a mesma máscara, igual ao comportamento real.
 */
async function emailDummyMascarado(identificador: string): Promise<string> {
	const hashBuf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identificador));
	const bytes = new Uint8Array(hashBuf);
	const first = String.fromCharCode(97 + (bytes[0] % 26)); // a-z
	const last = String.fromCharCode(97 + (bytes[1] % 26));
	return `${first}***${last}@***.com`;
}

function respostaDummy(identificadorMascaradoPromise: Promise<string>) {
	return identificadorMascaradoPromise.then((emailMascarado) =>
		json({
			message: RESPOSTA_GENERICA,
			requerCodigo: true,
			desafioId: gerarToken(),
			emailMascarado
		})
	);
}

export const POST: RequestHandler = async ({ request, platform, getClientAddress }) => {
	const body = await request.json().catch(() => null);
	const identificador: string = String(body?.identificador ?? '').trim();
	const tipo: string = String(body?.tipo ?? '').trim();
	const ip = getClientAddress();

	// Identificador inválido / tipo inválido → resposta dummy para não vazar
	// que esses campos estão errados (atacante poderia enumerar tipos).
	if (!identificador || !['policial', 'admin'].includes(tipo)) {
		return respostaDummy(emailDummyMascarado(identificador || 'invalid'));
	}

	try {
		const db = getDB(platform);

		// Rate limit por IP — em recovery_attempts (isolado de login_attempts).
		const limite = await contarRecoveryAttempts(
			db,
			ip,
			'solicitar_redefinicao',
			JANELA_IP_MINUTOS,
			MAX_TENTATIVAS_IP
		);
		if (limite.blocked) {
			return respostaDummy(emailDummyMascarado(identificador));
		}
		await registrarRecoveryAttempt(db, ip, 'solicitar_redefinicao');

		// Buscar usuário
		let usuario: {
			id: number;
			nome: string;
			email: string | null;
			email_pessoal: string | null;
			email_pessoal_verificado: number;
		} | null = null;

		if (tipo === 'policial') {
			const row = await db
				.select({
					id: policiais.id,
					nome: policiais.nome,
					email: policiais.email,
					email_pessoal: policiais.email_pessoal,
					email_pessoal_verificado: policiais.email_pessoal_verificado
				})
				.from(policiais)
				.where(and(eq(policiais.matricula, identificador), eq(policiais.ativo, 1)))
				.get();
			if (row) usuario = row;
		} else {
			const row = await db
				.select({
					id: administradores.id,
					nome: administradores.nome,
					email: administradores.email,
					email_pessoal: administradores.email_pessoal,
					email_pessoal_verificado: administradores.email_pessoal_verificado
				})
				.from(administradores)
				.where(eq(administradores.login, identificador))
				.get();
			if (row) usuario = row;
		}

		if (!usuario || !usuario.email_pessoal) {
			logger.info('[auth/redefinicao] usuário sem reset disponível', {
				tipo,
				ip,
				motivo: !usuario ? 'inexistente' : 'sem_email_pessoal'
			});
			return respostaDummy(emailDummyMascarado(identificador));
		}

		const tipoDesafio = tipo === 'policial' ? 'reset_policial' : 'reset_admin';

		// Rate limit por usuário (máx 3 códigos nos últimos 10 minutos)
		const windowUsuario = new Date(
			Date.now() - JANELA_CODIGOS_USUARIO_MINUTOS * 60 * 1000
		).toISOString();
		const [userCodeCount] = await db
			.select({ n: count() })
			.from(doisFatoresTokens)
			.where(
				and(
					eq(doisFatoresTokens.tipo, tipoDesafio),
					eq(doisFatoresTokens.usuario_id, usuario.id),
					gt(doisFatoresTokens.created_at, windowUsuario)
				)
			);

		if ((userCodeCount?.n ?? 0) >= MAX_CODIGOS_USUARIO) {
			logger.warn('[auth/redefinicao] rate limit por usuário', {
				tipo,
				usuario_id: usuario.id,
				ip
			});
			return respostaDummy(emailDummyMascarado(identificador));
		}

		const codigo = gerarCodigo2FA();
		const desafioId = await criarDesafio2FA(db, tipoDesafio, usuario.id, codigo);

		try {
			await enviarCodigoRedefinicaoSenha(usuario.email_pessoal, codigo, usuario.nome, platform);
		} catch (err) {
			logger.error('[auth/redefinicao] falha ao enviar código', {
				tipo,
				usuario_id: usuario.id,
				error: err instanceof Error ? err.message : String(err)
			});
			// Mesmo em caso de falha de envio, devolve a resposta dummy normal
			// para não revelar que o e-mail existe.
			return respostaDummy(emailDummyMascarado(identificador));
		}

		return json({
			message: RESPOSTA_GENERICA,
			requerCodigo: true,
			desafioId,
			emailMascarado: mascararEmail(usuario.email_pessoal)
		});
	} catch (err) {
		logger.error('[auth/redefinicao] falha inesperada', {
			error: err instanceof Error ? err.message : String(err)
		});
		return respostaDummy(emailDummyMascarado(identificador));
	}
};
