import { redirect, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { eq, and } from 'drizzle-orm';
import { getDB, auditar, contextoDeEvento } from '$lib/db';
import {
	verificarDesafio2FA,
	criarSessao,
	criarTokenRedefinicao,
	obterRotaBemVindo
} from '$lib/auth';
import { enviarLinkPrimeiroAcesso } from '$lib/server/email';
import { logger } from '$lib/server/logger';
import {
	tentarLogin,
	LOGIN_WINDOW_MINUTES,
	cookieOptions,
	type AdminModulo
} from '$lib/server/auth-flow';
import { contarRecoveryAttempts, registrarRecoveryAttempt } from '$lib/server/recovery-rate-limit';
import { administradores, policiais } from '$lib/server/schema';
import { loginSchema } from '$lib/schemas';
import { resolverAppOrigin } from '$lib/server/app-origin';

/**
 * Form actions de `/login` — a porta de entrada por FORMULÁRIO.
 *
 * A regra de autenticação em si mora em `$lib/server/auth-flow` (senha,
 * bootstrap por env, rate limit por IP e por conta); esta rota orquestra o que
 * é específico da navegação: cookies de sessão e de módulo admin, destino
 * pós-login e o segundo fator quando a conta exige.
 *
 * Existe uma rota JSON equivalente (`/api/auth/login`, usada pelo cliente com
 * fetch). As duas precisam aplicar os MESMOS limites — uma porta com throttle e
 * outra sem seria um brute-force gratuito. Daí os tetos replicados abaixo.
 */

const PRIMEIRO_ACESSO_MAX_TENTATIVAS_IP = 5;
const PRIMEIRO_ACESSO_JANELA_IP_MINUTOS = 15;

// Mesmos tetos da rota JSON /api/auth/verificar-2fa — sem eles aqui, a form
// action seria uma porta paralela sem throttle para brute-force do código.
const VERIFICAR_2FA_MAX = 10;
const VERIFICAR_2FA_WINDOW_MIN = 15;

/** Já autenticado não vê a tela de login: vai direto para a boas-vindas do papel. */
export const load: PageServerLoad = async ({ locals, cookies }) => {
	const u = locals.usuario;
	if (u) {
		const adminModulo = cookies.get('admin_modulo');
		redirect(302, obterRotaBemVindo(u, adminModulo));
	}
	return {};
};

export const actions: Actions = {
	/**
	 * Login por senha. Três desfechos possíveis:
	 * sessão criada · pendente de 2FA (nada de cookie de sessão ainda) · recusa.
	 */
	login: async ({ request, cookies, platform, url, getClientAddress }) => {
		const db = getDB(platform);
		const ip = getClientAddress();
		const formData = await request.formData();
		const matricula = formData.get('matricula') as string;
		const senha = formData.get('senha') as string;
		const tipo = formData.get('tipo') as 'policial' | 'admin';
		const adminModulo = ((formData.get('adminModulo') as string) || 'ambas') as AdminModulo;

		const parsed = loginSchema.safeParse({ matricula, senha, tipo });
		if (!parsed.success) {
			return fail(400, { error: parsed.error.issues[0].message, fields: { matricula, tipo } });
		}

		const result = await tentarLogin({
			db,
			ip,
			matricula: parsed.data.matricula,
			senha: parsed.data.senha,
			tipo: parsed.data.tipo,
			platform,
			formAdminModulo: adminModulo
		});

		if (!result.sucesso && result.statusCode === 429) {
			return fail(429, {
				error: `Muitas tentativas. Tente em ${LOGIN_WINDOW_MINUTES} minutos.`,
				fields: { matricula, tipo }
			});
		}

		if (!result.sucesso && 'pendente2FA' in result) {
			if (result.setAdminModuloPendingCookie) {
				cookies.set('admin_modulo_pending', adminModulo, {
					...cookieOptions(url),
					maxAge: 15 * 60
				});
			}
			const p = result.pendente2FA;
			return {
				pendente2FA: true,
				desafioId: p.desafioId,
				nome: p.nome,
				primeiro_acesso: p.primeiroAcesso,
				emailMascarado: p.emailMascarado,
				tipoUsuario2FA: p.tipoUsuario2FA
			};
		}

		if (!result.sucesso) {
			return fail(result.statusCode as 400 | 401 | 403 | 429 | 500, {
				error: result.erro,
				fields: result.fields ?? { matricula, tipo }
			});
		}

		cookies.set('session_token', result.token, cookieOptions(url));
		if (result.role === 'admin' && result.adminModuloCookie !== undefined) {
			cookies.set('admin_modulo', result.adminModuloCookie, cookieOptions(url));
		}
		if (!result.formRedirect) {
			return fail(500, { error: 'Resposta de login incompleta.' });
		}
		// Releitura do cadastro só para calcular o DESTINO: `auth-flow` devolve uma
		// rota genérica, e a boas-vindas certa depende de papel/cargo/módulo — dados
		// que ele não carrega. Em primeiro acesso o destino é fixo (troca de senha),
		// então a consulta é pulada.
		let redirectUrl = result.formRedirect;
		if (!result.primeiroAcesso) {
			if (result.role === 'admin') {
				const admin = await db
					.select()
					.from(administradores)
					.where(eq(administradores.login, matricula))
					.get();
				if (admin) {
					const mappedUser = {
						id: admin.id,
						tipo: 'admin' as const,
						nome: admin.nome,
						primeiro_acesso: false
					};
					redirectUrl = obterRotaBemVindo(mappedUser, result.adminModuloCookie);
				}
			} else {
				const policial = await db
					.select()
					.from(policiais)
					.where(eq(policiais.matricula, matricula))
					.get();
				if (policial) {
					const mappedUser = {
						id: policial.id,
						tipo: 'policial' as const,
						nome: policial.nome,
						primeiro_acesso: false,
						papel: policial.papel ?? null,
						papel_unidade_id: policial.papel_unidade_id ?? null,
						cargo: policial.cargo as 'DPC' | 'OIP'
					};
					redirectUrl = obterRotaBemVindo(mappedUser, null);
				}
			}
		}
		return {
			success: true,
			redirect: redirectUrl,
			primeiro_acesso: result.primeiroAcesso,
			nome: result.nome
		};
	},

	verificar2FA: async (event) => {
		const { request, cookies, platform, url, getClientAddress } = event;
		const db = getDB(platform);
		const ip = getClientAddress();
		const formData = await request.formData();
		const desafioId = formData.get('desafioId') as string;
		const codigo = formData.get('codigo') as string;

		if (!desafioId || !codigo) {
			return fail(400, { error: 'Dados inválidos' });
		}

		// Teto por IP (mesmo da rota JSON): o contador de 5 tentativas por desafio
		// é resetável via reenvio de código, então sem este teto o atacante recicla
		// desafios indefinidamente. Fail-open: erro no contador não quebra o login.
		try {
			const { blocked } = await contarRecoveryAttempts(
				db,
				ip,
				'verificar_2fa',
				VERIFICAR_2FA_WINDOW_MIN,
				VERIFICAR_2FA_MAX
			);
			if (blocked) {
				return fail(429, { error: 'Muitas tentativas. Faça login novamente em alguns minutos.' });
			}
		} catch (err) {
			logger.error('[login/verificar2FA] Falha no rate-limit (fail-open)', {
				error: err instanceof Error ? err.message : String(err)
			});
		}

		const resultado = await verificarDesafio2FA(db, desafioId, String(codigo), [
			'policial',
			'admin'
		]);

		if (resultado === 'expirado' || resultado === 'esgotado' || !resultado) {
			try {
				await registrarRecoveryAttempt(db, ip, 'verificar_2fa');
			} catch (err) {
				logger.error('[login/verificar2FA] Falha ao registrar tentativa (fail-open)', {
					error: err instanceof Error ? err.message : String(err)
				});
			}
		}

		if (resultado === 'expirado') {
			return fail(401, { error: 'Código expirado. Faça login novamente.', expirado: true });
		}
		if (resultado === 'esgotado') {
			return fail(429, {
				error: 'Muitas tentativas incorretas. Faça login novamente.',
				esgotado: true
			});
		}
		if (!resultado) {
			return fail(401, { error: 'Código inválido. Verifique e tente novamente.' });
		}

		const { tipo, usuarioId } = resultado;

		let primeiroAcesso: boolean;
		let mappedUser;
		if (tipo === 'admin') {
			const admin = await db
				.select()
				.from(administradores)
				.where(eq(administradores.id, usuarioId))
				.get();
			if (!admin) return fail(404, { error: 'Usuário não encontrado' });
			primeiroAcesso = admin.primeiro_acesso === 1;
			mappedUser = {
				id: admin.id,
				tipo: 'admin' as const,
				nome: admin.nome,
				primeiro_acesso: primeiroAcesso
			};
		} else {
			const policial = await db.select().from(policiais).where(eq(policiais.id, usuarioId)).get();
			if (!policial || policial.ativo === 0) return fail(403, { error: 'Usuário inativo' });
			primeiroAcesso = policial.primeiro_acesso === 1;
			mappedUser = {
				id: policial.id,
				tipo: 'policial' as const,
				nome: policial.nome,
				primeiro_acesso: primeiroAcesso,
				papel: policial.papel ?? null,
				papel_unidade_id: policial.papel_unidade_id ?? null,
				cargo: policial.cargo as 'DPC' | 'OIP'
			};
		}

		const token = await criarSessao(db, tipo as 'policial' | 'admin', usuarioId);
		cookies.set('session_token', token, cookieOptions(url));

		// Auditoria do login. ESTE é o caminho que a tela de login usa (form action),
		// paralelo à rota JSON /api/auth/verificar-2fa. Sem este registro, logins pelo
		// formulário não apareciam na trilha (só os logouts, via /api/auth/logout).
		const { contexto, env } = contextoDeEvento(event);
		await auditar(
			db,
			{
				acao: 'login',
				usuario: { id: usuarioId, nome: mappedUser.nome, tipo: tipo as 'policial' | 'admin' },
				entidade: tipo,
				entidade_id: usuarioId,
				detalhes: `Login com 2FA por e-mail (${tipo})`,
				metadados: { via: '2fa' },
				...contexto
			},
			{ env }
		);

		if (tipo === 'admin') {
			const pendingModulo = cookies.get('admin_modulo_pending') || 'ambas';
			cookies.set('admin_modulo', pendingModulo, cookieOptions(url));
			cookies.delete('admin_modulo_pending', { path: '/' });
			return {
				success: true,
				redirect: primeiroAcesso ? '/alterar-senha' : obterRotaBemVindo(mappedUser, pendingModulo),
				primeiro_acesso: primeiroAcesso
			};
		}

		return {
			success: true,
			redirect: primeiroAcesso ? '/alterar-senha' : obterRotaBemVindo(mappedUser, null),
			primeiro_acesso: primeiroAcesso
		};
	},

	/**
	 * Envia o link de primeiro acesso ao e-mail pessoal já cadastrado.
	 *
	 * Responde SEMPRE com sucesso, exista a conta ou não: a mensagem não pode
	 * revelar quais matrículas existem. O limite por IP é o que impede usar a
	 * rota para enumerar o cadastro.
	 */
	solicitarPrimeiroAcesso: async ({ request, platform, url, getClientAddress }) => {
		const db = getDB(platform);
		const ip = getClientAddress();
		const formData = await request.formData();
		const matricula = formData.get('matricula') as string;

		if (!matricula || typeof matricula !== 'string') {
			return fail(400, { error: 'Matrícula inválida.' });
		}

		const respostaGenerica = { success: true, enviado: true };

		// Rate limit em recovery_attempts (isolado de login_attempts, IP anonimizado)
		// — mesma mecânica da rota /api/auth/primeiro-acesso.
		const limite = await contarRecoveryAttempts(
			db,
			ip,
			'primeiro_acesso',
			PRIMEIRO_ACESSO_JANELA_IP_MINUTOS,
			PRIMEIRO_ACESSO_MAX_TENTATIVAS_IP
		);
		if (limite.blocked) {
			return respostaGenerica;
		}
		await registrarRecoveryAttempt(db, ip, 'primeiro_acesso');

		const policial = await db
			.select()
			.from(policiais)
			.where(and(eq(policiais.matricula, matricula.trim()), eq(policiais.ativo, 1)))
			.get();

		// Anti-enumeração: TODAS as respostas de pré-requisitos devolvem a mesma
		// resposta genérica — um 422 "sem e-mail cadastrado" diferenciaria
		// matrícula existente de inexistente. A informação útil fica no log.
		if (!policial || policial.primeiro_acesso !== 1 || !policial.email) {
			if (policial && !policial.email) {
				logger.warn('[login/primeiro-acesso] matrícula sem e-mail cadastrado', {
					policial_id: policial.id
				});
			}
			return respostaGenerica;
		}

		const token = await criarTokenRedefinicao(db, 'policial', policial.id);
		const link = `${resolverAppOrigin(url, platform)}/redefinir-senha?token=${token}`;

		try {
			await enviarLinkPrimeiroAcesso(policial.email, policial.nome, link, platform);
		} catch (err) {
			logger.error('[login/primeiro-acesso] Falha ao enviar e-mail', {
				policial_id: policial.id,
				error: err instanceof Error ? err.message : String(err)
			});
			return fail(500, { error: 'Falha ao enviar e-mail. Tente novamente.' });
		}

		return respostaGenerica;
	}
};
