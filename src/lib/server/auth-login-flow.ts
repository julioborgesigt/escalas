/**
 * Fluxo único de login por matricula/senha/tipo — usado pela API JSON e pelo form action.
 * Mantém rate limit, auditoria, migração de hash legado e 2FA alinhados entre os dois canais.
 */
import { eq, and } from 'drizzle-orm';
import { registrarAuditComContexto } from '$lib/db';
import {
	hashSenha,
	verificarSenha,
	isHashLegado,
	criarSessao,
	gerarCodigo2FA,
	criarDesafio2FA,
	compararSegredoUtf8TimingSafe
} from '$lib/auth';
import { enviarCodigo2FA } from '$lib/server/email';
import {
	checkLoginRateLimit,
	LOGIN_WINDOW_MINUTES,
	mascararEmailLogin,
	recordLoginAttempt
} from '$lib/server/login-helpers';
import { logger } from '$lib/server/logger';
import { administradores, policiais } from '$lib/server/schema';
import type { Database } from '$lib/db';

export type LoginPasswordInput = {
	matricula: string;
	senha: string;
	tipo: 'policial' | 'admin';
};

export type AdminModulo = 'ambas' | 'gise' | 'escalas';

/** Resultado do fluxo — os handlers só mapeiam para json / fail / cookies. */
export type LoginPasswordResult =
	| { outcome: 'rate_limited' }
	| {
			outcome: 'error';
			httpStatus: 400 | 401 | 429 | 500;
			message: string;
			fields?: { matricula?: string; tipo?: string };
	  }
	| {
			outcome: '2fa';
			desafioId: string;
			nome: string;
			primeiro_acesso: boolean;
			emailMascarado: string;
			tipoUsuario2FA: 'admin' | 'policial';
			/** Só true no form: gravar admin_modulo_pending após enviar e-mail */
			setAdminModuloPendingCookie: boolean;
	  }
	| {
			outcome: 'session';
			token: string;
			nome: string;
			primeiro_acesso: boolean;
			/** admin criado via env ou admin da tabela */
			role: 'admin' | 'policial';
			/** Form: caminho após login (API ignora) */
			formRedirect?: string;
			/** Form admin: valor do cookie admin_modulo quando aplicável */
			adminModuloCookie?: AdminModulo;
	  };

function adminDestino(modulo: AdminModulo): string {
	if (modulo === 'gise') return '/gise';
	if (modulo === 'escalas') return '/recebidos';
	return '/painel';
}

/**
 * Executa login com senha. Não define cookies — só devolve token e metadados.
 * @param formAdminModulo — obrigatório para fluxo admin no form; na API pode ser omitido (usa 'ambas' só para cálculo irrelevante no env).
 */
export async function executeLoginPassword(
	db: Database,
	ip: string,
	platform: App.Platform | undefined,
	input: LoginPasswordInput,
	options: { formAdminModulo?: AdminModulo }
): Promise<LoginPasswordResult> {
	const rateLimit = await checkLoginRateLimit(db, ip);
	if (rateLimit.blocked) {
		return { outcome: 'rate_limited' };
	}

	const { matricula, senha, tipo } = input;
	const adminModulo: AdminModulo = options.formAdminModulo ?? 'ambas';
	const isForm = options.formAdminModulo !== undefined;

	if (tipo === 'admin') {
		const _env = platform?.env as Env | undefined;
		const envLogin = _env?.ADMIN_GERAL_LOGIN?.trim() ?? '';
		const envSenha = _env?.ADMIN_GERAL_SENHA ?? '';

		if (envLogin && envSenha && matricula === envLogin) {
			if (!compararSegredoUtf8TimingSafe(senha, envSenha)) {
				await recordLoginAttempt(db, ip, false);
				await registrarAuditComContexto(db, {
					usuario: null,
					acao: 'falha_login',
					entidade: 'admin',
					detalhes: `Tentativa falha para admin geral: ${matricula}`,
					ip
				});
				return {
					outcome: 'error',
					httpStatus: 401,
					message: 'Login ou senha inválidos',
					fields: { matricula, tipo }
				};
			}

			let envAdmin = await db.select().from(administradores).where(eq(administradores.login, envLogin)).get();
			if (!envAdmin) {
				const senhaHash = await hashSenha(crypto.randomUUID());
				await db.insert(administradores).values({
					login: envLogin,
					nome: 'Administrador Geral',
					senha: senhaHash,
					primeiro_acesso: 0
				});
				envAdmin = await db.select().from(administradores).where(eq(administradores.login, envLogin)).get();
			}
			if (!envAdmin) {
				return { outcome: 'error', httpStatus: 500, message: 'Erro ao inicializar administrador.' };
			}

			await recordLoginAttempt(db, ip, true);
			const token = await criarSessao(db, 'admin', envAdmin.id);
			return {
				outcome: 'session',
				token,
				nome: envAdmin.nome,
				primeiro_acesso: false,
				role: 'admin',
				formRedirect: isForm ? adminDestino(adminModulo) : undefined,
				adminModuloCookie: isForm ? adminModulo : undefined
			};
		}

		const admin = await db.select().from(administradores).where(eq(administradores.login, matricula)).get();
		if (!admin || !(await verificarSenha(senha, admin.senha))) {
			await recordLoginAttempt(db, ip, false);
			return {
				outcome: 'error',
				httpStatus: 401,
				message: 'Login ou senha inválidos',
				fields: { matricula, tipo }
			};
		}

		if (isHashLegado(admin.senha)) {
			const novoHash = await hashSenha(senha);
			await db.update(administradores).set({ senha: novoHash }).where(eq(administradores.id, admin.id));
		}

		await recordLoginAttempt(db, ip, true);

		if (admin.email && admin.primeiro_acesso !== 1) {
			const codigo = gerarCodigo2FA();
			const desafioId = await criarDesafio2FA(db, 'admin', admin.id, codigo);
			try {
				await enviarCodigo2FA(admin.email, codigo, admin.nome, platform);
			} catch (err) {
				logger.error('[2FA] Falha ao enviar e-mail (admin)', {
					error: err instanceof Error ? err.message : String(err)
				});
				return {
					outcome: 'error',
					httpStatus: 500,
					message: 'Falha ao enviar código de verificação. Contate o administrador.',
					fields: { matricula, tipo }
				};
			}
			return {
				outcome: '2fa',
				desafioId,
				nome: admin.nome,
				primeiro_acesso: admin.primeiro_acesso === 1,
				emailMascarado: mascararEmailLogin(admin.email),
				tipoUsuario2FA: 'admin',
				setAdminModuloPendingCookie: isForm
			};
		}

		const token = await criarSessao(db, 'admin', admin.id);
		const dest = adminDestino(adminModulo);
		return {
			outcome: 'session',
			token,
			nome: admin.nome,
			primeiro_acesso: admin.primeiro_acesso === 1,
			role: 'admin',
			formRedirect: isForm ? (admin.primeiro_acesso === 1 ? '/alterar-senha' : dest) : undefined,
			adminModuloCookie: isForm ? adminModulo : undefined
		};
	}

	const policial = await db
		.select()
		.from(policiais)
		.where(and(eq(policiais.matricula, matricula), eq(policiais.ativo, 1)))
		.get();

	if (!policial || !(await verificarSenha(senha, policial.senha))) {
		await recordLoginAttempt(db, ip, false);
		return {
			outcome: 'error',
			httpStatus: 401,
			message: 'Matrícula ou senha inválidos',
			fields: { matricula, tipo }
		};
	}

	if (isHashLegado(policial.senha)) {
		const novoHash = await hashSenha(senha);
		await db.update(policiais).set({ senha: novoHash }).where(eq(policiais.id, policial.id));
	}

	await recordLoginAttempt(db, ip, true);

	if (policial.email && policial.primeiro_acesso !== 1) {
		const codigo = gerarCodigo2FA();
		const desafioId = await criarDesafio2FA(db, 'policial', policial.id, codigo);
		try {
			await enviarCodigo2FA(policial.email, codigo, policial.nome, platform);
		} catch (err) {
			logger.error('[2FA] Falha ao enviar e-mail (policial)', {
				error: err instanceof Error ? err.message : String(err)
			});
			return {
				outcome: 'error',
				httpStatus: 500,
				message: 'Falha ao enviar código de verificação. Contate o administrador.',
				fields: { matricula, tipo }
			};
		}
		return {
			outcome: '2fa',
			desafioId,
			nome: policial.nome,
			primeiro_acesso: policial.primeiro_acesso === 1,
			emailMascarado: mascararEmailLogin(policial.email),
			tipoUsuario2FA: 'policial',
			setAdminModuloPendingCookie: false
		};
	}

	const token = await criarSessao(db, 'policial', policial.id);
	return {
		outcome: 'session',
		token,
		nome: policial.nome,
		primeiro_acesso: policial.primeiro_acesso === 1,
		role: 'policial',
		formRedirect: isForm ? (policial.primeiro_acesso === 1 ? '/alterar-senha' : '/escalas') : undefined
	};
}

export { LOGIN_WINDOW_MINUTES };
