/**
 * Fluxo único de login (matrícula/senha/tipo) — formulário (+page.server) e API JSON.
 * Rate limit, auditoria, migração de hash legado e 2FA permanecem alinhados entre os canais.
 */
import { eq, and, gt, sql, count } from 'drizzle-orm';
import { bytesToHex } from '$lib/crypto/hex';
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
import { captureMessage } from '@sentry/cloudflare';
import { enviarCodigo2FA } from '$lib/server/email';
import { logger } from '$lib/server/logger';
import { administradores, policiais, loginAttempts } from '$lib/server/schema';
import type { Database } from '$lib/db';
import { chaveRateLimitIp } from '$lib/server/recovery-rate-limit';
import { mascararEmail } from '$lib/utils';

export { mascararEmail };

// ---- Rate limit e utilitários (antes em login-helpers) ----

const LOGIN_MAX_ATTEMPTS = 5;
export const LOGIN_WINDOW_MINUTES = 15;
// Throttle por CONTA (account lockout) — complementa o por-IP, fechando o
// brute-force distribuído (vários IPs contra UMA matrícula). Teto mais alto que
// o por-IP (agrega vários IPs) e janela curta auto-expirável: o impacto de DoS
// (travar uma conta de propósito) fica limitado a ACCOUNT_WINDOW_MINUTES e se
// cura sozinho. Contas com 2FA por e-mail têm proteção adicional.
const ACCOUNT_MAX_ATTEMPTS = 10;
const ACCOUNT_WINDOW_MINUTES = 15;

/**
 * Fail-closed do 2º fator (auditoria A1): uma conta com a senha correta mas SEM
 * e-mail cadastrado para o 2FA NÃO recebe sessão — exceto no onboarding de
 * primeiro acesso (sessão confinada a /alterar-senha, onde o e-mail é
 * cadastrado/verificado). Antes, a ausência de e-mail pulava o 2FA
 * silenciosamente e o login caía para fator único (só senha). Quem não tem
 * e-mail pode autenticar pelo login com certificado digital (Token A3), que é
 * posse criptográfica e não depende de OTP por e-mail.
 */
const SEM_EMAIL_2FA_MSG =
	'Sua conta não possui e-mail cadastrado para o segundo fator de autenticação. ' +
	'Contate o administrador para cadastrar seu e-mail ou entre com certificado digital (Token A3).';



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

/**
 * Compara a senha digitada com o segredo de bootstrap da env.
 *
 * Aceita DOIS formatos na env (`SUPER_ADMIN_SENHA` / `ADMIN_GERAL_SENHA`):
 *   - hash PBKDF2 (`pbkdf2v2:...` gerado por `hashSenha`) — RECOMENDADO: quem
 *     lê o dashboard/wrangler não vê a senha em claro;
 *   - texto claro (legado) — comparação timing-safe, mantido por compat.
 */
async function verificarSenhaBootstrap(
	senha: string,
	envValor: string,
	pepper?: string
): Promise<boolean> {
	if (envValor.startsWith('pbkdf2v')) {
		return verificarSenha(senha, envValor, pepper);
	}
	return compararSegredoUtf8TimingSafe(senha, envValor);
}

/** Alerta de uso de credencial root: log + Sentry (não só log, fácil de perder). */
function alertarLoginBootstrap(mensagem: string, ip: string): void {
	logger.warn(mensagem, { ip });
	try {
		captureMessage(mensagem, 'warning');
	} catch {
		/* Sentry indisponível não pode quebrar o login break-glass */
	}
}

export async function checkRateLimit(
	db: Database,
	ip: string
): Promise<{ blocked: boolean; remaining: number }> {
	// Deve usar a mesma chave que recordAttempt grava — sem isso a consulta
	// nunca encontra os registros e o rate limit fica inoperante. Com
	// RATE_LIMIT_IP_SALT, a chave é o hash salteado do IP completo (granular);
	// sem o salt, /24 anonimizado (legado).
	const ipNormalized = await chaveRateLimitIp(ip);
	/** Mesmo relógio/formato que `attempted_at` (default `datetime('now')` no SQLite). */
	const desde = sql.raw(`datetime('now', '-${LOGIN_WINDOW_MINUTES} minutes')`);
	const attempts = await db
		.select()
		.from(loginAttempts)
		.where(
			and(
				eq(loginAttempts.ip, ipNormalized),
				gt(loginAttempts.attempted_at, desde),
				eq(loginAttempts.success, 0)
			)
		)
		.all();
	const count = attempts.length;
	return {
		blocked: count >= LOGIN_MAX_ATTEMPTS,
		remaining: Math.max(0, LOGIN_MAX_ATTEMPTS - count)
	};
}

export async function recordAttempt(
	db: Database,
	ip: string,
	success: boolean,
	identifier?: string
): Promise<void> {
	await db.insert(loginAttempts).values({
		ip: await chaveRateLimitIp(ip),
		success: success ? 1 : 0,
		identifier: identifier ?? null
	});
}

/**
 * Hash do identificador da conta (`tipo:matricula`, normalizado) para contar
 * tentativas por conta SEM gravar a matrícula em texto no log de tentativas.
 */
async function hashIdentificadorLogin(tipo: string, matricula: string): Promise<string> {
	const data = new TextEncoder().encode(`${tipo}:${matricula.trim().toLowerCase()}`);
	const buf = await crypto.subtle.digest('SHA-256', data);
	return bytesToHex(new Uint8Array(buf));
}

/**
 * Conta tentativas FALHAS para a conta (por hash do identificador) na janela.
 * Complementa `checkRateLimit` (por IP): pega brute-force distribuído por
 * múltiplos IPs contra a mesma conta.
 */
async function checkAccountRateLimit(
	db: Database,
	identifierHash: string
): Promise<{ blocked: boolean }> {
	const desde = sql.raw(`datetime('now', '-${ACCOUNT_WINDOW_MINUTES} minutes')`);
	const [row] = await db
		.select({ n: count() })
		.from(loginAttempts)
		.where(
			and(
				eq(loginAttempts.identifier, identifierHash),
				gt(loginAttempts.attempted_at, desde),
				eq(loginAttempts.success, 0)
			)
		);
	return { blocked: (row?.n ?? 0) >= ACCOUNT_MAX_ATTEMPTS };
}

/** Alias legado — mesmo que `cookieOptions`. */
export const cookieOptionsLogin = (url: URL) => cookieOptions(url);

export type AdminModulo = 'ambas' | 'gise' | 'escalas';

type TentarLoginArgs = {
	db: Database;
	ip: string;
	matricula: string;
	senha: string;
	tipo: 'policial' | 'admin';
	platform: App.Platform | undefined;
	/** Só no login por formulário admin — define cookie admin_modulo após 2FA */
	formAdminModulo?: AdminModulo;
};

type Pendente2FA = {
	desafioId: string;
	nome: string;
	primeiroAcesso: boolean;
	emailMascarado: string;
	tipoUsuario2FA: 'admin' | 'policial';
};

type TentarLoginResult =
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
			statusCode: 400 | 401 | 403 | 429 | 500;
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
	// Pepper (A3): segredo global do ambiente. Quando presente, `verificarSenha`
	// consegue conferir hashes v3 e o login re-hasha v1/v2/legado → v3.
	const pepper = (platform?.env as Env | undefined)?.PASSWORD_PEPPER?.trim() || undefined;

	const rateLimit = await checkRateLimit(db, ip);
	if (rateLimit.blocked) {
		return {
			sucesso: false,
			statusCode: 429,
			erro: `Muitas tentativas de login. Tente novamente em ${LOGIN_WINDOW_MINUTES} minutos.`
		};
	}

	// Throttle por CONTA (account lockout): pega brute-force distribuído por
	// vários IPs contra a mesma matrícula — o limite por IP acima não cobre isso.
	// Mesma mensagem 429 do limite por IP (não revela se o bloqueio é de IP ou de
	// conta) e aplica-se uniformemente, inclusive a matrículas inexistentes (toda
	// falha grava o identifier), então não vira oráculo de enumeração.
	const identHash = await hashIdentificadorLogin(tipo, matricula);
	const accountLimit = await checkAccountRateLimit(db, identHash);
	if (accountLimit.blocked) {
		return {
			sucesso: false,
			statusCode: 429,
			erro: `Muitas tentativas de login. Tente novamente em ${ACCOUNT_WINDOW_MINUTES} minutos.`
		};
	}

	const adminModulo: AdminModulo = formAdminModulo ?? 'ambas';
	const isForm = formAdminModulo !== undefined;
	const _env = platform?.env as Env | undefined;

	if (tipo === 'admin') {
		const superLogin = _env?.SUPER_ADMIN_LOGIN?.trim() ?? '';
		const superSenha = _env?.SUPER_ADMIN_SENHA ?? '';

		if (superLogin && superSenha && matricula === superLogin) {
			if (!(await verificarSenhaBootstrap(senha, superSenha, pepper))) {
				await recordAttempt(db, ip, false, identHash);
				await registrarAuditComContexto(db, {
					usuario: null,
					acao: 'falha_login',
					entidade: 'admin',
					detalhes: `Tentativa falha para super admin: ${matricula}`,
					ip
				});
				return {
					sucesso: false,
					statusCode: 401,
					erro: 'Login ou senha inválidos',
					fields: { matricula, tipo }
				};
			}

			// Garantir que existe o registro do super admin no DB para ter id da sessão
			let superAdmin = await db
				.select()
				.from(administradores)
				.where(eq(administradores.login, superLogin))
				.get();

			if (!superAdmin) {
				const senhaHash = await hashSenha(crypto.randomUUID());
				await db.insert(administradores).values({
					login: superLogin,
					nome: 'Super Administrador',
					senha: senhaHash,
					primeiro_acesso: 0
				});
				superAdmin = await db
					.select()
					.from(administradores)
					.where(eq(administradores.login, superLogin))
					.get();
			}

			if (!superAdmin) {
				return {
					sucesso: false,
					statusCode: 500,
					erro: 'Erro ao inicializar super administrador.'
				};
			}

			await recordAttempt(db, ip, true, identHash);

			// O bootstrap por env tem poder de root. Por padrão loga direto (sem
			// 2FA) — break-glass que funciona mesmo com e-mail fora do ar. Se
			// SUPER_ADMIN_EMAIL estiver configurado, exigimos o 2º fator também na
			// conta root, fechando o bypass de 2FA do bootstrap.
			const superEmail = _env?.SUPER_ADMIN_EMAIL?.trim() ?? '';
			if (superEmail) {
				const codigo = gerarCodigo2FA();
				const desafioId = await criarDesafio2FA(db, 'admin', superAdmin.id, codigo);
				const emailJob = enviarCodigo2FA(superEmail, codigo, superAdmin.nome, platform).catch(
					(err) => {
						logger.error('[2FA] Falha ao enviar e-mail (super admin)', {
							error: err instanceof Error ? err.message : String(err)
						});
					}
				);
				platform?.ctx?.waitUntil(emailJob);
				return {
					sucesso: false,
					statusCode: 200,
					pendente2FA: {
						desafioId,
						nome: superAdmin.nome,
						primeiroAcesso: false,
						emailMascarado: mascararEmail(superEmail),
						tipoUsuario2FA: 'admin'
					},
					setAdminModuloPendingCookie: isForm
				};
			}

			alertarLoginBootstrap(
				'[security] Login do Super Admin via bootstrap env SEM 2FA (break-glass). ' +
					'Configure SUPER_ADMIN_EMAIL para exigir segundo fator nesta conta root.',
				ip
			);
			// Rastreabilidade forense (A7): registra no audit log consultável o uso
			// do break-glass root sem 2FA. try/catch — auditoria não pode derrubar o
			// login de emergência.
			try {
				await registrarAuditComContexto(db, {
					usuario: null,
					acao: 'login_bootstrap',
					entidade: 'admin',
					detalhes: 'Super Admin autenticado via bootstrap env SEM 2FA (break-glass)',
					ip
				});
			} catch {
				/* auditoria indisponível não bloqueia o break-glass */
			}
			const token = await criarSessao(db, 'admin', superAdmin.id);
			return {
				sucesso: true,
				statusCode: 200,
				token,
				nome: superAdmin.nome,
				primeiroAcesso: false,
				role: 'admin',
				formRedirect: isForm ? adminDestino(adminModulo) : undefined,
				adminModuloCookie: isForm ? adminModulo : undefined
			};
		}

		const envLogin = _env?.ADMIN_GERAL_LOGIN?.trim() ?? '';
		const envSenha = _env?.ADMIN_GERAL_SENHA ?? '';

		if (envLogin && envSenha && matricula === envLogin) {
			// Bootstrap por variáveis de ambiente: credenciais do admin geral
			// vivem em `ADMIN_GERAL_LOGIN/SENHA`. Usado tanto para setup inicial
			// (sem registro no DB) quanto como login operacional enquanto o
			// admin não tiver e-mail pessoal verificado configurado.
			//
			// Janela de bloqueio: após o admin completar o fluxo de
			// `/alterar-senha` (que exige e-mail pessoal verificado), o
			// bootstrap fica desabilitado — o admin passa a logar pelo fluxo
			// normal com 2FA. Sinal de "setup concluído" = ter `email` setado.
			//
			// NOTA: uma tentativa de fechar isto mais agressivamente (bloquear
			// sempre que o registro existe) foi revertida em hotfix porque
			// quebra deploys existentes onde admin foi criado com `email=null`
			// e usa o env como login diário. Para reabrir esse fechamento,
			// migre o admin para fluxo de e-mail verificado primeiro.
			const envAdminExistente = await db
				.select()
				.from(administradores)
				.where(eq(administradores.login, envLogin))
				.get();

			if (envAdminExistente?.email) {
				// Setup concluído (admin tem e-mail) — bootstrap desnecessário.
				logger.error(
					'[security] Bootstrap bloqueado: admin já possui e-mail configurado. ' +
						'Remova ADMIN_GERAL_LOGIN e ADMIN_GERAL_SENHA das variáveis de ambiente ' +
						'e use o fluxo de redefinição de senha por e-mail.',
					{ ip }
				);
				await recordAttempt(db, ip, false, identHash);
				await registrarAuditComContexto(db, {
					usuario: null,
					acao: 'falha_login',
					entidade: 'admin',
					detalhes: 'Tentativa de login via bootstrap bloqueada (setup já concluído)',
					ip
				});
				return {
					sucesso: false,
					statusCode: 401,
					erro: 'Login ou senha inválidos',
					fields: { matricula, tipo }
				};
			}

			alertarLoginBootstrap(
				'[security] Login via credenciais de bootstrap (ADMIN_GERAL). ' +
					'Configure e-mail pessoal verificado e remova ADMIN_GERAL_LOGIN/SENHA do ambiente ' +
					'para encerrar este caminho sem 2FA.',
				ip
			);

			if (!(await verificarSenhaBootstrap(senha, envSenha, pepper))) {
				await recordAttempt(db, ip, false, identHash);
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

			// Cria o admin inicial se ainda não existe.
			let envAdmin = envAdminExistente;
			if (!envAdmin) {
				const senhaHash = await hashSenha(crypto.randomUUID());
				await db.insert(administradores).values({
					login: envLogin,
					nome: 'Administrador Geral',
					senha: senhaHash,
					primeiro_acesso: 0
				});
				envAdmin = await db
					.select()
					.from(administradores)
					.where(eq(administradores.login, envLogin))
					.get();
			}
			if (!envAdmin) {
				return { sucesso: false, statusCode: 500, erro: 'Erro ao inicializar administrador.' };
			}

			// 2FA no bootstrap ADMIN_GERAL — espelha o SUPER_ADMIN: quando
			// ADMIN_GERAL_EMAIL está configurado, exigimos o 2º fator também aqui,
			// fechando o login direto (sem 2FA) da conta de bootstrap.
			const adminGeralEmail = _env?.ADMIN_GERAL_EMAIL?.trim() ?? '';
			if (adminGeralEmail) {
				await recordAttempt(db, ip, true, identHash);
				const codigo = gerarCodigo2FA();
				const desafioId = await criarDesafio2FA(db, 'admin', envAdmin.id, codigo);
				const emailJob = enviarCodigo2FA(adminGeralEmail, codigo, envAdmin.nome, platform).catch(
					(err) => {
						logger.error('[2FA] Falha ao enviar e-mail (admin geral)', {
							error: err instanceof Error ? err.message : String(err)
						});
					}
				);
				platform?.ctx?.waitUntil(emailJob);
				return {
					sucesso: false,
					statusCode: 200,
					pendente2FA: {
						desafioId,
						nome: envAdmin.nome,
						primeiroAcesso: false,
						emailMascarado: mascararEmail(adminGeralEmail),
						tipoUsuario2FA: 'admin'
					},
					setAdminModuloPendingCookie: isForm
				};
			}

			await recordAttempt(db, ip, true, identHash);
			// Rastreabilidade forense (A7): registra o uso do bootstrap ADMIN_GERAL
			// (sem 2FA) no audit log consultável. try/catch — não pode quebrar o login.
			try {
				await registrarAuditComContexto(db, {
					usuario: null,
					acao: 'login_bootstrap',
					entidade: 'admin',
					detalhes: 'Admin Geral autenticado via bootstrap env (sem 2FA)',
					ip
				});
			} catch {
				/* auditoria indisponível não bloqueia o login */
			}
			const token = await criarSessao(db, 'admin', envAdmin.id);
			return {
				sucesso: true,
				statusCode: 200,
				token,
				nome: envAdmin.nome,
				primeiroAcesso: false,
				role: 'admin',
				formRedirect: isForm ? adminDestino(adminModulo) : undefined,
				adminModuloCookie: isForm ? adminModulo : undefined
			};
		}

		const admin = await db
			.select()
			.from(administradores)
			.where(eq(administradores.login, matricula))
			.get();
		if (!admin || !(await verificarSenha(senha, admin.senha, pepper))) {
			await recordAttempt(db, ip, false, identHash);
			return {
				sucesso: false,
				statusCode: 401,
				erro: 'Login ou senha inválidos',
				fields: { matricula, tipo }
			};
		}

		if (isHashLegado(admin.senha, !!pepper)) {
			const novoHash = await hashSenha(senha, pepper);
			await db
				.update(administradores)
				.set({ senha: novoHash })
				.where(eq(administradores.id, admin.id));
		}

		await recordAttempt(db, ip, true, identHash);

		if (admin.email && admin.primeiro_acesso !== 1) {
			const codigo = gerarCodigo2FA();
			const desafioId = await criarDesafio2FA(db, 'admin', admin.id, codigo);
			const emailJob = enviarCodigo2FA(admin.email, codigo, admin.nome, platform).catch((err) => {
				logger.error('[2FA] Falha ao enviar e-mail (admin)', {
					error: err instanceof Error ? err.message : String(err)
				});
			});
			platform?.ctx?.waitUntil(emailJob);
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

		// Fail-closed do 2º fator (A1): sem e-mail para enviar o código e fora do
		// onboarding, a senha sozinha não concede sessão. primeiro_acesso continua
		// permitido (sessão confinada a /alterar-senha, onde o e-mail é cadastrado).
		if (!admin.email && admin.primeiro_acesso !== 1) {
			logger.warn('[login] Bloqueado: admin sem e-mail para 2FA', { adminId: admin.id });
			return {
				sucesso: false,
				statusCode: 403,
				erro: SEM_EMAIL_2FA_MSG,
				fields: { matricula, tipo }
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

	if (!policial || !(await verificarSenha(senha, policial.senha, pepper))) {
		await recordAttempt(db, ip, false, identHash);
		return {
			sucesso: false,
			statusCode: 401,
			erro: 'Matrícula ou senha inválidos',
			fields: { matricula, tipo }
		};
	}

	if (isHashLegado(policial.senha, !!pepper)) {
		const novoHash = await hashSenha(senha, pepper);
		await db.update(policiais).set({ senha: novoHash }).where(eq(policiais.id, policial.id));
	}

	await recordAttempt(db, ip, true, identHash);

	if (policial.email && policial.primeiro_acesso !== 1) {
		const codigo = gerarCodigo2FA();
		const desafioId = await criarDesafio2FA(db, 'policial', policial.id, codigo);
		const emailJob = enviarCodigo2FA(policial.email, codigo, policial.nome, platform).catch(
			(err) => {
				logger.error('[2FA] Falha ao enviar e-mail (policial)', {
					error: err instanceof Error ? err.message : String(err)
				});
			}
		);
		platform?.ctx?.waitUntil(emailJob);
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

	// Fail-closed do 2º fator (A1): mesma regra do fluxo admin — sem e-mail e fora
	// do onboarding, não há sessão por senha. Login por Token A3 segue disponível.
	if (!policial.email && policial.primeiro_acesso !== 1) {
		logger.warn('[login] Bloqueado: policial sem e-mail para 2FA', { policialId: policial.id });
		return {
			sucesso: false,
			statusCode: 403,
			erro: SEM_EMAIL_2FA_MSG,
			fields: { matricula, tipo }
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
		formRedirect: isForm
			? policial.primeiro_acesso === 1
				? '/alterar-senha'
				: '/escalas'
			: undefined
	};
}
