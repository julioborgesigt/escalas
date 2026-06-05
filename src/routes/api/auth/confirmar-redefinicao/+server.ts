/**
 * POST /api/auth/confirmar-redefinicao
 *
 * Confirma o código enviado ao e-mail pessoal e, somente então, valida esse
 * e-mail, cria o token de redefinição de senha e envia o link por e-mail.
 */

import { json } from '@sveltejs/kit';
import { and, count, eq, gt } from 'drizzle-orm';
import { getDB, registrarAuditComContexto } from '$lib/db';
import { criarTokenRedefinicao, verificarDesafio2FA } from '$lib/auth';
import { enviarLinkRedefinicaoSenha } from '$lib/server/email';
import { administradores, policiais, resetSenhaTokens } from '$lib/server/schema';
import { contarRecoveryAttempts, registrarRecoveryAttempt } from '$lib/server/recovery-rate-limit';
import { badRequest, rateLimited, validateBody } from '$lib/server/api';
import { confirmarRedefinicaoSchema } from '$lib/schemas';
import type { RequestHandler } from './$types';

const RESPOSTA_GENERICA =
	'Dentro de instantes você receberá em seu e-mail funcional um link de redefinição de senha.';
const MAX_TENTATIVAS_IP = 5;
const JANELA_IP_MINUTOS = 15;
const MAX_TOKENS_USUARIO = 3;
const JANELA_USUARIO_MINUTOS = 60;

type TipoUsuarioReset = 'policial' | 'admin';

type UsuarioReset = {
	id: number;
	nome: string;
	email: string | null;
	email_pessoal: string | null;
	email_pessoal_verificado: number;
};

export const POST: RequestHandler = async ({ request, platform, url, getClientAddress }) => {
	const v = await validateBody(request, confirmarRedefinicaoSchema);
	if (!v.ok) return v.response;
	const { desafioId, codigo } = v.data;

	const db = getDB(platform);
	const ip = getClientAddress();

	const limite = await contarRecoveryAttempts(
		db,
		ip,
		'confirmar_redefinicao',
		JANELA_IP_MINUTOS,
		MAX_TENTATIVAS_IP
	);
	if (limite.blocked) {
		return json({ message: RESPOSTA_GENERICA });
	}
	await registrarRecoveryAttempt(db, ip, 'confirmar_redefinicao');

	const resultado = await verificarDesafio2FA(db, desafioId, codigo, [
		'reset_policial',
		'reset_admin'
	]);

	if (resultado === 'expirado') return badRequest('Código expirado. Solicite um novo código.');
	if (resultado === 'esgotado') {
		return rateLimited('Muitas tentativas incorretas. Solicite um novo código.');
	}
	if (!resultado) return badRequest('Código inválido');

	const tipo: TipoUsuarioReset = resultado.tipo === 'reset_policial' ? 'policial' : 'admin';
	let usuario: UsuarioReset | null = null;

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
			.where(and(eq(policiais.id, resultado.usuarioId), eq(policiais.ativo, 1)))
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
			.where(eq(administradores.id, resultado.usuarioId))
			.get();
		if (row) usuario = row;
	}

	if (!usuario || !usuario.email_pessoal || !usuario.email) {
		return json({ message: RESPOSTA_GENERICA });
	}

	const windowUsuario = new Date(Date.now() - JANELA_USUARIO_MINUTOS * 60 * 1000).toISOString();
	const [userTokenCount] = await db
		.select({ n: count() })
		.from(resetSenhaTokens)
		.where(
			and(
				eq(resetSenhaTokens.tipo_usuario, tipo),
				eq(resetSenhaTokens.usuario_id, usuario.id),
				gt(resetSenhaTokens.created_at, windowUsuario)
			)
		);

	if ((userTokenCount?.n ?? 0) >= MAX_TOKENS_USUARIO) {
		return json({ message: RESPOSTA_GENERICA });
	}

	const token = await criarTokenRedefinicao(db, tipo, usuario.id);
	const link = `${url.origin}/redefinir-senha?token=${token}`;

	if (usuario.email_pessoal_verificado !== 1) {
		if (tipo === 'policial') {
			await db
				.update(policiais)
				.set({ email_pessoal_verificado: 1 })
				.where(eq(policiais.id, usuario.id));
		} else {
			await db
				.update(administradores)
				.set({ email_pessoal_verificado: 1 })
				.where(eq(administradores.id, usuario.id));
		}
	}

	await enviarLinkRedefinicaoSenha(usuario.email, usuario.nome, link, platform);

	await registrarAuditComContexto(db, {
		usuario: { id: usuario.id, nome: usuario.nome },
		acao: 'solicitar_redefinicao_senha',
		entidade: tipo === 'policial' ? 'policiais' : 'administradores',
		entidade_id: usuario.id,
		ip
	});

	return json({ message: RESPOSTA_GENERICA });
};
