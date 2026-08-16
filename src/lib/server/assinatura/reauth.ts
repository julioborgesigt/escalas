/**
 * Reautenticação por senha na cerimônia de assinatura avançada.
 *
 * A sessão prova quem é; reinserir a senha prova vontade ATUAL. Sem isto,
 * um colega na cadeira (ou um celular desbloqueado) assinava com a sessão
 * aberta. Não cobre o inciso "b" da Lei 14.063 e não sobe o nível jurídico
 * sozinha — é piso da cerimônia, não teatro: recusa no servidor, janela de
 * ~10 min reutilizável no lote, sem matrícula, sem flag vinda do cliente.
 *
 * A senha é a mesma que o login lê (`credencialDoUsuario`): Admin Geral
 * vinculado autentica contra `policiais.senha`, não contra o placeholder da
 * linha admin. Bootstrap por env (admin ainda sem e-mail) cai no mesmo
 * `verificarSenhaBootstrap` do login — a linha tem hash aleatório.
 */
import { eq } from 'drizzle-orm';
import { verificarSenha } from '$lib/crypto/password-hash';
import { administradores, policiais } from '../schema';
import { credencialDoUsuario } from '../auth/credencial';
import { verificarSenhaBootstrap } from '../auth/auth-flow';
import { contarRecoveryAttempts, registrarRecoveryAttempt } from '../auth/recovery-rate-limit';
import { conferirJanelaReauth, criarJanelaReauth } from '$lib/db/reauth';
import type { Database } from '$lib/db';
import { ErrorCode } from '../api';
import { ERRO_REAUTH_AUSENTE, ERRO_REAUTH_INVALIDA } from '$lib/assinatura-reauth';

export { ERRO_REAUTH_AUSENTE, ERRO_REAUTH_INVALIDA };

const SENHA_MAX_TENTATIVAS = 5;
const SENHA_JANELA_MIN = 15;

type UsuarioReauth = {
	id: number;
	tipo: 'policial' | 'admin';
	adminPolicialId?: number | null;
};

export type FalhaReauth = {
	ok: false;
	status: 401 | 403 | 429;
	error: string;
	code?: (typeof ErrorCode)[keyof typeof ErrorCode];
};

/**
 * Confere a senha, aplica rate-limit por usuário e abre a janela.
 *
 * Recusas de senha devolvem a mesma frase — não revelam se a sessão é de
 * outro, se o hash está ausente ou se o bootstrap não bate.
 */
export async function abrirJanelaReauthAssinatura(
	db: Database,
	usuario: UsuarioReauth,
	senha: string,
	sessaoToken: string,
	opts: {
		ip: string;
		pepper?: string;
		env?: {
			ADMIN_GERAL_LOGIN?: string;
			ADMIN_GERAL_SENHA?: string;
			SUPER_ADMIN_LOGIN?: string;
			SUPER_ADMIN_SENHA?: string;
		};
	}
): Promise<{ ok: true; reauthId: string } | FalhaReauth> {
	const chaveThrottle = `senha-atual:${usuario.tipo}:${usuario.id}`;
	const { blocked } = await contarRecoveryAttempts(
		db,
		chaveThrottle,
		'reauth_assinatura',
		SENHA_JANELA_MIN,
		SENHA_MAX_TENTATIVAS
	);
	if (blocked) {
		return {
			ok: false,
			status: 429,
			error: `Muitas tentativas de senha incorretas. Tente novamente em ${SENHA_JANELA_MIN} minutos.`,
			code: ErrorCode.RATE_LIMIT
		};
	}

	const bateu = await senhaDoUsuarioConfere(db, usuario, senha, opts.pepper, opts.env);
	if (!bateu) {
		await registrarRecoveryAttempt(db, chaveThrottle, 'reauth_assinatura');
		return {
			ok: false,
			status: 401,
			error: 'Senha incorreta',
			code: ErrorCode.AUTH_REQUIRED
		};
	}

	const reauthId = await criarJanelaReauth(db, { tipo: usuario.tipo, id: usuario.id }, sessaoToken);
	return { ok: true, reauthId };
}

/**
 * Gate da janela no POST de assinar. Não consome. Mesma mensagem para
 * ausente/inválida/de outro — sondar não mapeia o que existe.
 */
export async function exigirJanelaReauth(
	db: Database,
	usuario: { tipo: 'policial' | 'admin'; id: number },
	reauthId: string | undefined | null,
	sessaoToken: string | undefined | null
): Promise<{ ok: true } | FalhaReauth> {
	const r = await conferirJanelaReauth(db, reauthId, usuario, sessaoToken);
	if (r.ok) return r;
	return {
		ok: false,
		status: 403,
		error: r.motivo === 'ausente' ? ERRO_REAUTH_AUSENTE : ERRO_REAUTH_INVALIDA,
		code: ErrorCode.FORBIDDEN
	};
}

async function senhaDoUsuarioConfere(
	db: Database,
	usuario: UsuarioReauth,
	senha: string,
	pepper: string | undefined,
	env:
		| {
				ADMIN_GERAL_LOGIN?: string;
				ADMIN_GERAL_SENHA?: string;
				SUPER_ADMIN_LOGIN?: string;
				SUPER_ADMIN_SENHA?: string;
		  }
		| undefined
): Promise<boolean> {
	const alvo = credencialDoUsuario(usuario);
	const registro =
		alvo.tipo === 'policial'
			? await db
					.select({ senha: policiais.senha })
					.from(policiais)
					.where(eq(policiais.id, alvo.id))
					.get()
			: await db
					.select({ senha: administradores.senha })
					.from(administradores)
					.where(eq(administradores.id, alvo.id))
					.get();

	if (registro && (await verificarSenha(senha, registro.senha, pepper))) {
		return true;
	}

	// Bootstrap por env: a linha admin nasce com hash aleatório; o login lê
	// ADMIN_GERAL_SENHA / SUPER_ADMIN_SENHA enquanto não há e-mail. Sem este
	// ramo, o Admin Geral de setup não assinaria — a senha que ele usa não
	// está na linha.
	if (usuario.tipo !== 'admin' || !env) return false;
	const admin = await db
		.select({ login: administradores.login, email: administradores.email })
		.from(administradores)
		.where(eq(administradores.id, usuario.id))
		.get();
	if (!admin || admin.email) return false;

	if (
		env.ADMIN_GERAL_LOGIN &&
		admin.login === env.ADMIN_GERAL_LOGIN &&
		env.ADMIN_GERAL_SENHA &&
		(await verificarSenhaBootstrap(senha, env.ADMIN_GERAL_SENHA, pepper))
	) {
		return true;
	}
	if (
		env.SUPER_ADMIN_LOGIN &&
		admin.login === env.SUPER_ADMIN_LOGIN &&
		env.SUPER_ADMIN_SENHA &&
		(await verificarSenhaBootstrap(senha, env.SUPER_ADMIN_SENHA, pepper))
	) {
		return true;
	}
	return false;
}
