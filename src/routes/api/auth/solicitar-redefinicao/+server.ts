/**
 * POST /api/auth/solicitar-redefinicao
 *
 * Rota pública. Recebe identificador (matrícula ou login) e tipo de usuário,
 * cria um token de redefinição de senha e envia o link por e-mail.
 *
 * Sempre retorna a mesma mensagem genérica, independente de o usuário existir
 * ou não, para evitar enumeração de usuários.
 */

import { json } from '@sveltejs/kit';
import { eq, and, gt, count } from 'drizzle-orm';
import { getDB, registrarAuditComContexto } from '$lib/db';
import { criarTokenRedefinicao } from '$lib/auth';
import { enviarLinkRedefinicaoSenha } from '$lib/server/email';
import { administradores, policiais, loginAttempts, resetSenhaTokens } from '$lib/server/schema';
import type { RequestHandler } from './$types';

const RESPOSTA_GENERICA = 'Se o identificador estiver cadastrado com e-mail, você receberá um link de redefinição em instantes.';
const MAX_TENTATIVAS_IP = 5;
const JANELA_IP_MINUTOS = 15;
const MAX_TOKENS_USUARIO = 3;
const JANELA_USUARIO_MINUTOS = 60;

export const POST: RequestHandler = async ({ request, platform, url, getClientAddress }) => {
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

	// Rate limit por usuário (máx 3 tokens na última hora)
	const windowUsuario = new Date(Date.now() - JANELA_USUARIO_MINUTOS * 60 * 1000).toISOString();
	const [userTokenCount] = await db
		.select({ n: count() })
		.from(resetSenhaTokens)
		.where(
			and(
				eq(resetSenhaTokens.tipo_usuario, tipo as 'policial' | 'admin'),
				eq(resetSenhaTokens.usuario_id, usuario.id),
				gt(resetSenhaTokens.created_at, windowUsuario)
			)
		);

	if ((userTokenCount?.n ?? 0) >= MAX_TOKENS_USUARIO) {
		return json({ message: RESPOSTA_GENERICA });
	}

	// Criar token e link
	const token = await criarTokenRedefinicao(db, tipo as 'policial' | 'admin', usuario.id);
	const link = `${url.origin}/redefinir-senha?token=${token}`;

	// Enviar para ambos os e-mails usando allSettled para não bloquear se um falhar
	const envios: Promise<void>[] = [];
	if (usuario.email) {
		envios.push(enviarLinkRedefinicaoSenha(usuario.email, usuario.nome, link, platform));
	}
	if (usuario.email_pessoal && usuario.email_pessoal_verificado === 1) {
		envios.push(enviarLinkRedefinicaoSenha(usuario.email_pessoal, usuario.nome, link, platform));
	}

	await Promise.allSettled(envios);

	// Auditoria
	await registrarAuditComContexto(db, {
		usuario: { id: usuario.id, nome: usuario.nome },
		acao: 'solicitar_redefinicao_senha',
		entidade: tipo === 'policial' ? 'policiais' : 'administradores',
		entidade_id: usuario.id,
		ip
	});

	return json({ message: RESPOSTA_GENERICA });
};
