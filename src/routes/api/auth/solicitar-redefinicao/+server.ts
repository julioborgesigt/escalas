/**
 * POST /api/auth/solicitar-redefinicao
 *
 * Rota pública. Recebe identificador (matrícula ou login) e tipo de usuário,
 * cria um desafio e envia um código ao e-mail pessoal verificado do usuário.
 *
 * Sempre retorna a mesma mensagem genérica, independente de o usuário existir
 * ou não, para evitar enumeração de usuários.
 */

import { json } from '@sveltejs/kit';
import { eq, and, gt, count } from 'drizzle-orm';
import { getDB } from '$lib/db';
import { criarDesafio2FA, gerarCodigo2FA } from '$lib/auth';
import { enviarCodigoRedefinicaoSenha } from '$lib/server/email';
import {
	administradores,
	policiais,
	loginAttempts,
	doisFatoresTokens
} from '$lib/server/schema';
import { mascararEmail } from '$lib/server/auth-flow';
import type { RequestHandler } from './$types';

const RESPOSTA_GENERICA =
	'Se o identificador estiver cadastrado com e-mail pessoal verificado, você receberá um código de validação em instantes.';
const MAX_TENTATIVAS_IP = 5;
const JANELA_IP_MINUTOS = 15;
const MAX_CODIGOS_USUARIO = 3;
const JANELA_CODIGOS_USUARIO_MINUTOS = 10;

export const POST: RequestHandler = async ({ request, platform, getClientAddress }) => {
	const body = await request.json().catch(() => null);
	const identificador: string = String(body?.identificador ?? '').trim();
	const tipo: string = String(body?.tipo ?? '').trim();

	if (!identificador || !['policial', 'admin'].includes(tipo)) {
		return json({ message: RESPOSTA_GENERICA });
	}

	const db = getDB(platform);
	const ip = getClientAddress();

	// Rate limit por IP
	const windowIp = new Date(Date.now() - JANELA_IP_MINUTOS * 60 * 1000).toISOString();
	const [ipCount] = await db
		.select({ n: count() })
		.from(loginAttempts)
		.where(and(eq(loginAttempts.ip, ip), gt(loginAttempts.attempted_at, windowIp)));

	if ((ipCount?.n ?? 0) >= MAX_TENTATIVAS_IP) {
		return json({ message: RESPOSTA_GENERICA });
	}

	// Registrar tentativa por IP
	await db.insert(loginAttempts).values({ ip, success: 0 });

	// Buscar usuário
	let usuario: { id: number; nome: string; email: string | null; email_pessoal: string | null; email_pessoal_verificado: number } | null = null;

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

	if (!usuario) {
		return json({ message: RESPOSTA_GENERICA });
	}

	if (!usuario.email_pessoal || usuario.email_pessoal_verificado !== 1) {
		return json({ message: RESPOSTA_GENERICA });
	}

	const tipoDesafio = tipo === 'policial' ? 'reset_policial' : 'reset_admin';

	// Rate limit por usuário (máx 3 códigos nos últimos 10 minutos)
	const windowUsuario = new Date(Date.now() - JANELA_CODIGOS_USUARIO_MINUTOS * 60 * 1000).toISOString();
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
		return json({ message: RESPOSTA_GENERICA });
	}

	const codigo = gerarCodigo2FA();
	const desafioId = await criarDesafio2FA(db, tipoDesafio, usuario.id, codigo);

	try {
		await enviarCodigoRedefinicaoSenha(usuario.email_pessoal, codigo, usuario.nome, platform);
	} catch {
		return json({ message: RESPOSTA_GENERICA });
	}

	return json({
		message: 'Enviamos um código de validação para o e-mail pessoal cadastrado.',
		requerCodigo: true,
		desafioId,
		emailMascarado: mascararEmail(usuario.email_pessoal)
	});
};
