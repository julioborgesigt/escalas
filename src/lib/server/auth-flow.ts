/**
 * Fluxo único de login (matrícula/senha/tipo) — formulário (+page.server) e API JSON.
 * Rate limit, auditoria, migração de hash legado e 2FA permanecem alinhados entre os canais.
 */
import { eq, and, gt, sql } from 'drizzle-orm';
import { registrarAuditComContexto } from '$lib/db';
import {
	hashSenha,
	verificarSenha,
	isHashLegado,
	criarSessao,
	gerarCodigo2FA,
	criarDesafio2FA,
	compararSegredoUtf8TimingSafe,
	SESSION_TTL_MS
} from '$lib/auth';
import { enviarCodigo2FA } from '$lib/server/email';
import { logger } from '$lib/server/logger';
import { administradores, policiais, loginAttempts } from '$lib/server/schema';
import type { Database } from '$lib/db';
import { anonimizarIp } from '$lib/db/audit';

// ---- Rate limit e utilitários (antes em login-helpers) ----

export const LOGIN_MAX_ATTEMPTS = 5;
export const LOGIN_WINDOW_MINUTES = 15;

export function mascararEmail(email: string): string {
	const at = email.indexOf('@');
	if (at <= 0) return email;
	const local = email.slice(0, at);
	const domain = email.slice(at + 1);
	let masked: string;
	if (local.length === 1) {
		masked = local;
	} else if (local.length === 2) {
		masked = local[0] + '*';
	} else {
		const showStart = Math.min(2, Math.floor(local.length / 2));
		masked =
			local.slice(0, showStart) +
			'*'.repeat(local.length - showStart - 1) +
			local[local.length - 1];
	}
	// Ocultar domínio para não revelar provedor (ex: gmail.com → ***.com)
	const dotIdx = domain.lastIndexOf('.');
	const maskedDomain = dotIdx > 0 ? '***' + domain.slice(dotIdx) : '***';
	return masked + '@' + maskedDomain;
}

/**
 * Opções de cookie de sessão pós-login (httpOnly, sameSite, secure).
 *
 * `maxAge` é alinhado com `SESSION_TTL_MS` (8h) e estendido implicitamente:
 * cada validação de sessão que cruza o threshold sliding atualiza
 * `sessoes.expires_at` no banco. O cookie em si é renovado quando o navegador
 * recebe um novo `Set-Cookie` (ex.: pós-login, pós-2FA, pós-troca de senha).
 */
export function cookieOptions(url: URL) {
	return {
		path: '/',
		httpOnly: true,
		sameSite: 'strict' as const,
		secure: url.protocol === 'https:',
		maxAge: Math.floor(SESSION_TTL_MS / 1000)
	};
}

export async function checkRateLimit(
	db: Database,
	ip: string
): Promise<{ blocked: boolean; remaining: number }> {
	// Deve usar o mesmo IP anonimizado que recordAttempt grava — sem isso a
	// consulta nunca encontra os registros e o rate limit fica inoperante.
	const ipNormalized = anonimizarIp(ip) ?? ip;
	/** Mesmo relógio/formato que `attempted_at` (default `datetime('now')` no SQLite). */
	const desde = sql.raw(`datetime('now', '-${LOGIN_WINDOW_MINUTES} minutes')`);
	const attempts = await db
		.select()
		.from(loginAttempts)
		.where(
			and(eq(loginAttempts.ip, ipNormalized), gt(loginAttempts.attempted_at, desde), eq(loginAttempts.success, 0))
		)
		.all();
	const count = attempts.length;
	return {
		blocked: count >= LOGIN_MAX_ATTEMPTS,
		remaining: Math.max(0, LOGIN_MAX_ATTEMPTS - count)
	};
}

export async function recordAttempt(db: Database, ip: string, success: boolean): Promise<void> {
	await db.insert(loginAttempts).values({ ip: anonimizarIp(ip) ?? ip, success: success ? 1 : 0 });
}

/** Alias legado — mesmo que `cookieOptions`. */
export const cookieOptionsLogin = (url: URL) => cookieOptions(url);

export type AdminModulo = 'ambas' | 'gise' | 'escalas';

export type TentarLoginArgs = {
	db: Database;
	ip: string;
	matricula: string;
	senha: string;
	tipo: 'policial' | 'admin';
	platform: App.Platform | undefined;
	/** Só no login por formulário admin — define cookie admin_modulo após 2FA */
	formAdminModulo?: AdminModulo;
};

export type Pendente2FA = {
	desafioId: string;
	nome: string;
	primeiroAcesso: boolean;
	emailMascarado: string;
	tipoUsuario2FA: 'admin' | 'policial';
};

export type TentarLoginResult =
	| {
			sucesso: true;
			statusCode: 200;
			token: string;
			nome: string;
			primeiroAcesso: boolean;
			role: 'admin' | 'policial';
			formRedirect?: string;
			adminModuloCookie?: AdminModulo;
	  }
	| {
			sucesso: false;
			statusCode: 200;
			pendente2FA: Pendente2FA;
			setAdminModuloPendingCookie: boolean;
	  }
	| { sucesso: false; statusCode: 429; erro: string }
	| {
			sucesso: false;
			statusCode: 400 | 401 | 429 | 500;
			erro: string;
			fields?: { matricula?: string; tipo?: string };
	  };

function adminDestino(modulo: AdminModulo): string {
	if (modulo === 'gise') return '/gise';
	if (modulo === 'escalas') return '/recebidos';
	return '/painel';
}

/**
 * Login com senha. Não define cookies — só devolve token e metadados para os handlers.
 */
export async function tentarLogin({
	db,
	ip,
	matricula,
	senha,
	tipo,
	platform,
	formAdminModulo
}: TentarLoginArgs): Promise<TentarLoginResult> {
	const rateLimit = await checkRateLimit(db, ip);
	if (rateLimit.blocked) {
		return {
			sucesso: false,
			statusCode: 429,
			erro: `Muitas tentativas de login. Tente novamente em ${LOGIN_WINDOW_MINUTES} minutos.`
		};
	}

	const adminModulo: AdminModulo = formAdminModulo ?? 'ambas';
	const isForm = formAdminModulo !== undefined;
	const _env = platform?.env as Env | undefined;

	if (tipo === 'admin') {
		const envLogin = _env?.ADMIN_GERAL_LOGIN?.trim() ?? '';
		const envSenha = _env?.ADMIN_GERAL_SENHA ?? '';

		if (envLogin && envSenha && matricula === envLogin) {
			// Bootstrap one-shot: as credenciais de ambiente só funcionam para
			// CRIAR o registro inicial do administrador. Assim que existir
			// QUALQUER admin no banco com o login configurado, este caminho
			// fica desabilitado — fechando a janela em que um admin sem e-mail
			// (criado por script, em meio ao setup) podia continuar logando
			// sem 2FA pelas credenciais de env.
			//
			// Recuperação de admin esquecido: usar o fluxo `/redefinir-senha`
			// (envia link por e-mail), nunca reativar o bootstrap.
			const envAdminExistente = await db
				.select()
				.from(administradores)
				.where(eq(administradores.login, envLogin))
				.get();

			if (envAdminExistente) {
				logger.error(
					'[security] Bootstrap bloqueado: registro do admin já existe. ' +
						'Remova ADMIN_GERAL_LOGIN e ADMIN_GERAL_SENHA do ambiente e ' +
						'use redefinição de senha por e-mail para recuperar acesso.',
					{ ip, adminTemEmail: !!envAdminExistente.email }
				);
				await recordAttempt(db, ip, false);
				await registrarAuditComContexto(db, {
					usuario: null,
					acao: 'falha_login',
					entidade: 'admin',
					detalhes: 'Tentativa de login via bootstrap bloqueada (admin já existe)',
					ip
				});
				return {
					sucesso: false,
					statusCode: 401,
					erro: 'Login ou senha inválidos',
					fields: { matricula, tipo }
				};
			}

			logger.warn(
				'[security] Bootstrap inicial do Admin Geral em execução. ' +
					'Remova ADMIN_GERAL_LOGIN e ADMIN_GERAL_SENHA do ambiente IMEDIATAMENTE ' +
					'após concluir o primeiro login — este caminho não será mais válido.',
				{ ip }
			);

			if (!compararSegredoUtf8TimingSafe(senha, envSenha)) {
				await recordAttempt(db, ip, false);
				await registrarAuditComContexto(db, {
					usuario: null,
					acao: 'falha_login',
					entidade: 'admin',
					detalhes: `Tentativa falha para admin geral: ${matricula}`,
					ip
				});
				return {
					sucesso: false,
					statusCode: 401,
					erro: 'Login ou senha inválidos',
					fields: { matricula, tipo }
				};
			}

			// Cria o admin inicial. Marca `primeiro_acesso = 1` para forçar a
			// configuração de senha + e-mail pessoal verificado já no primeiro
			// passo — depois disso, qualquer login deste admin passa pelo
			// fluxo normal (com 2FA), e o `envAdminExistente` acima bloqueia
			// novas tentativas de bootstrap.
			const senhaHash = await hashSenha(crypto.randomUUID());
			await db.insert(administradores).values({
				login: envLogin,
				nome: 'Administrador Geral',
				senha: senhaHash,
				primeiro_acesso: 1
			});
			const envAdmin = await db
				.select()
				.from(administradores)
				.where(eq(administradores.login, envLogin))
				.get();
			if (!envAdmin) {
				return { sucesso: false, statusCode: 500, erro: 'Erro ao inicializar administrador.' };
			}

			await recordAttempt(db, ip, true);
			const token = await criarSessao(db, 'admin', envAdmin.id);
			// `primeiroAcesso: true` força o front a ir para `/alterar-senha`
			// e completar a configuração de senha + e-mail pessoal verificado.
			// Após isso, o `envAdminExistente` no topo deste branch bloqueia
			// qualquer reuso do bootstrap, mesmo se as variáveis de ambiente
			// permanecerem por engano.
			return {
				sucesso: true,
				statusCode: 200,
				token,
				nome: envAdmin.nome,
				primeiroAcesso: true,
				role: 'admin',
				formRedirect: isForm ? '/alterar-senha' : undefined,
				adminModuloCookie: isForm ? adminModulo : undefined
			};
		}

		const admin = await db.select().from(administradores).where(eq(administradores.login, matricula)).get();
		if (!admin || !(await verificarSenha(senha, admin.senha, db))) {
			await recordAttempt(db, ip, false);
			return {
				sucesso: false,
				statusCode: 401,
				erro: 'Login ou senha inválidos',
				fields: { matricula, tipo }
			};
		}

		if (isHashLegado(admin.senha)) {
			const novoHash = await hashSenha(senha);
			await db.update(administradores).set({ senha: novoHash }).where(eq(administradores.id, admin.id));
		}

		await recordAttempt(db, ip, true);

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
					sucesso: false,
					statusCode: 500,
					erro: 'Falha ao enviar código de verificação. Contate o administrador.',
					fields: { matricula, tipo }
				};
			}
			return {
				sucesso: false,
				statusCode: 200,
				pendente2FA: {
					desafioId,
					nome: admin.nome,
					primeiroAcesso: admin.primeiro_acesso === 1,
					emailMascarado: mascararEmail(admin.email),
					tipoUsuario2FA: 'admin'
				},
				setAdminModuloPendingCookie: isForm
			};
		}

		const token = await criarSessao(db, 'admin', admin.id);
		const dest = adminDestino(adminModulo);
		return {
			sucesso: true,
			statusCode: 200,
			token,
			nome: admin.nome,
			primeiroAcesso: admin.primeiro_acesso === 1,
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

	if (!policial || !(await verificarSenha(senha, policial.senha, db))) {
		await recordAttempt(db, ip, false);
		return {
			sucesso: false,
			statusCode: 401,
			erro: 'Matrícula ou senha inválidos',
			fields: { matricula, tipo }
		};
	}

	if (isHashLegado(policial.senha)) {
		const novoHash = await hashSenha(senha);
		await db.update(policiais).set({ senha: novoHash }).where(eq(policiais.id, policial.id));
	}

	await recordAttempt(db, ip, true);

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
				sucesso: false,
				statusCode: 500,
				erro: 'Falha ao enviar código de verificação. Contate o administrador.',
				fields: { matricula, tipo }
			};
		}
		return {
			sucesso: false,
			statusCode: 200,
			pendente2FA: {
				desafioId,
				nome: policial.nome,
				primeiroAcesso: policial.primeiro_acesso === 1,
				emailMascarado: mascararEmail(policial.email),
				tipoUsuario2FA: 'policial'
			},
			setAdminModuloPendingCookie: false
		};
	}

	const token = await criarSessao(db, 'policial', policial.id);
	return {
		sucesso: true,
		statusCode: 200,
		token,
		nome: policial.nome,
		primeiroAcesso: policial.primeiro_acesso === 1,
		role: 'policial',
		formRedirect: isForm ? (policial.primeiro_acesso === 1 ? '/alterar-senha' : '/escalas') : undefined
	};
}
