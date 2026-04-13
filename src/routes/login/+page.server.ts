import { redirect, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { eq, and, gt } from 'drizzle-orm';
import { timingSafeEqual } from 'node:crypto';
import { getDB, registrarAuditComContexto } from '$lib/db';
import { hashSenha, verificarSenha, isHashLegado, criarSessao, gerarCodigo2FA, criarDesafio2FA, verificarDesafio2FA } from '$lib/auth';
import { enviarCodigo2FA, enviarSenhaProvisoria } from '$lib/server/email';
import { administradores, policiais, loginAttempts } from '$lib/server/schema';
import { loginSchema } from '$lib/schemas';

const MAX_ATTEMPTS = 5;
const WINDOW_MINUTES = 15;

function mascararEmail(email: string): string {
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
		masked = local.slice(0, showStart) + '*'.repeat(local.length - showStart - 1) + local[local.length - 1];
	}
	return masked + '@' + domain;
}

function cookieOptions(url: URL) {
	return {
		path: '/',
		httpOnly: true,
		sameSite: 'strict' as const,
		secure: url.protocol === 'https:',
		maxAge: 12 * 60 * 60
	};
}

/** Comparação de strings em tempo constante para evitar timing attacks. */
function senhaCorretaEnv(input: string, expected: string): boolean {
	const len = Math.max(input.length, expected.length, 1);
	const a = Buffer.alloc(len);
	const b = Buffer.alloc(len);
	a.write(input);
	b.write(expected);
	return ((timingSafeEqual(a, b) ? 1 : 0) & (input.length === expected.length ? 1 : 0)) === 1;
}

async function checkRateLimit(db: any, ip: string): Promise<{ blocked: boolean; remaining: number }> {
	const windowStart = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000).toISOString();
	const attempts = await db
		.select()
		.from(loginAttempts)
		.where(and(eq(loginAttempts.ip, ip), gt(loginAttempts.attempted_at, windowStart), eq(loginAttempts.success, 0)))
		.all();
	const count = attempts.length;
	return { blocked: count >= MAX_ATTEMPTS, remaining: Math.max(0, MAX_ATTEMPTS - count) };
}

async function recordAttempt(db: any, ip: string, success: boolean): Promise<void> {
	await db.insert(loginAttempts).values({ ip, success: success ? 1 : 0 });
}

function gerarSenhaProvisoria(): string {
	const letras = 'ABCDEFGHJKMNPQRSTUVWXYZ';
	const digitos = '23456789';
	const todos = letras + digitos;
	const bytes = new Uint8Array(8);
	crypto.getRandomValues(bytes);
	return Array.from(bytes)
		.map((b) => todos[b % todos.length])
		.join('');
}

export const load: PageServerLoad = async ({ locals }) => {
	// Se já está logado, redireciona
	const u = locals.usuario;
	if (u) {
		throw redirect(302, u.tipo === 'admin' ? '/painel' : '/escalas');
	}
	return {};
};

export const actions: Actions = {
	login: async ({ request, cookies, platform, url, getClientAddress }) => {
		const db = getDB(platform);
		const ip = getClientAddress();
		const formData = await request.formData();
		const matricula = formData.get('matricula') as string;
		const senha = formData.get('senha') as string;
		const tipo = formData.get('tipo') as 'policial' | 'admin';
		const adminModulo = (formData.get('adminModulo') as string) || 'ambas';

		const parsed = loginSchema.safeParse({ matricula, senha, tipo });
		if (!parsed.success) {
			return fail(400, { error: parsed.error.issues[0].message, fields: { matricula, tipo } });
		}

		const rateLimit = await checkRateLimit(db, ip);
		if (rateLimit.blocked) {
			return fail(429, { error: `Muitas tentativas. Tente em ${WINDOW_MINUTES} minutos.`, fields: { matricula, tipo } });
		}

		if (tipo === 'admin') {
			const _env = (platform as { env?: Record<string, string> } | undefined)?.env ?? {};
			const envLogin = _env.ADMIN_GERAL_LOGIN?.trim() ?? '';
			const envSenha = _env.ADMIN_GERAL_SENHA ?? '';

			if (envLogin && envSenha && matricula === envLogin) {
				if (!senhaCorretaEnv(senha, envSenha)) {
					await recordAttempt(db, ip, false);
					await registrarAuditComContexto(db, {
						usuario: null,
						acao: 'falha_login',
						entidade: 'admin',
						detalhes: `Tentativa falha para admin geral: ${matricula}`,
						ip
					});
					return fail(401, { error: 'Login ou senha inválidos', fields: { matricula, tipo } });
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
				if (!envAdmin) return fail(500, { error: 'Erro ao inicializar administrador.' });
				await recordAttempt(db, ip, true);
				const token = await criarSessao(db, 'admin', envAdmin.id);
				cookies.set('session_token', token, cookieOptions(url));
				cookies.set('admin_modulo', adminModulo, cookieOptions(url));
				const dest = adminModulo === 'gise' ? '/gise' : adminModulo === 'escalas' ? '/recebidos' : '/painel';
				return { success: true, redirect: dest, primeiro_acesso: false, nome: envAdmin.nome };
			}

			const admin = await db.select().from(administradores).where(eq(administradores.login, matricula)).get();
			if (!admin || !(await verificarSenha(senha, admin.senha))) {
				await recordAttempt(db, ip, false);
				return fail(401, { error: 'Login ou senha inválidos', fields: { matricula, tipo } });
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
					console.error('[2FA] Falha ao enviar e-mail:', err);
					return fail(500, { error: 'Falha ao enviar código de verificação.', fields: { matricula, tipo } });
				}
				// Persist adminModulo so it's available after 2FA
				cookies.set('admin_modulo_pending', adminModulo, { ...cookieOptions(url), maxAge: 15 * 60 });
				return {
					pendente2FA: true,
					desafioId,
					nome: admin.nome,
					primeiro_acesso: admin.primeiro_acesso === 1,
					emailMascarado: mascararEmail(admin.email),
					tipoUsuario2FA: 'admin'
				};
			}

			const token = await criarSessao(db, 'admin', admin.id);
			cookies.set('session_token', token, cookieOptions(url));
			cookies.set('admin_modulo', adminModulo, cookieOptions(url));
			const adminDest = adminModulo === 'gise' ? '/gise' : adminModulo === 'escalas' ? '/recebidos' : '/painel';
			return { success: true, redirect: admin.primeiro_acesso === 1 ? '/alterar-senha' : adminDest, primeiro_acesso: admin.primeiro_acesso === 1 };
		}

		// Policial
		const policial = await db.select().from(policiais).where(and(eq(policiais.matricula, matricula), eq(policiais.ativo, 1))).get();
		if (!policial || !(await verificarSenha(senha, policial.senha))) {
			await recordAttempt(db, ip, false);
			return fail(401, { error: 'Matrícula ou senha inválidos', fields: { matricula, tipo } });
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
				console.error('[2FA] Falha ao enviar e-mail:', err);
				return fail(500, { error: 'Falha ao enviar código de verificação.', fields: { matricula, tipo } });
			}
			return {
				pendente2FA: true,
				desafioId,
				nome: policial.nome,
				primeiro_acesso: policial.primeiro_acesso === 1,
				emailMascarado: mascararEmail(policial.email),
				tipoUsuario2FA: 'policial'
			};
		}

		const token = await criarSessao(db, 'policial', policial.id);
		cookies.set('session_token', token, cookieOptions(url));
		return { success: true, redirect: policial.primeiro_acesso === 1 ? '/alterar-senha' : '/escalas', primeiro_acesso: policial.primeiro_acesso === 1 };
	},

	verificar2FA: async ({ request, cookies, platform, url }) => {
		const db = getDB(platform);
		const formData = await request.formData();
		const desafioId = formData.get('desafioId') as string;
		const codigo = formData.get('codigo') as string;

		if (!desafioId || !codigo) {
			return fail(400, { error: 'Dados inválidos' });
		}

		const resultado = await verificarDesafio2FA(db, desafioId, String(codigo));

		if (resultado === 'expirado') {
			return fail(401, { error: 'Código expirado. Faça login novamente.', expirado: true });
		}
		if (resultado === 'esgotado') {
			return fail(429, { error: 'Muitas tentativas incorretas. Faça login novamente.', esgotado: true });
		}
		if (!resultado) {
			return fail(401, { error: 'Código inválido. Verifique e tente novamente.' });
		}

		const { tipo, usuarioId } = resultado;

		let primeiroAcesso = false;
		if (tipo === 'admin') {
			const admin = await db.select().from(administradores).where(eq(administradores.id, usuarioId)).get();
			if (!admin) return fail(404, { error: 'Usuário não encontrado' });
			primeiroAcesso = admin.primeiro_acesso === 1;
		} else {
			const policial = await db.select().from(policiais).where(eq(policiais.id, usuarioId)).get();
			if (!policial || policial.ativo === 0) return fail(403, { error: 'Usuário inativo' });
			primeiroAcesso = policial.primeiro_acesso === 1;
		}

		const token = await criarSessao(db, tipo as 'policial' | 'admin', usuarioId);
		cookies.set('session_token', token, cookieOptions(url));

		// Restore admin_modulo from pending cookie if this is an admin 2FA verification
		if (tipo === 'admin') {
			const pendingModulo = cookies.get('admin_modulo_pending') || 'ambas';
			cookies.set('admin_modulo', pendingModulo, cookieOptions(url));
			cookies.delete('admin_modulo_pending', { path: '/' });
			const adminDest2FA = pendingModulo === 'gise' ? '/gise' : pendingModulo === 'escalas' ? '/recebidos' : '/painel';
			return { success: true, redirect: primeiroAcesso ? '/alterar-senha' : adminDest2FA, primeiro_acesso: primeiroAcesso };
		}

		return { success: true, redirect: primeiroAcesso ? '/alterar-senha' : '/escalas', primeiro_acesso: primeiroAcesso };
	},

	solicitarPrimeiroAcesso: async ({ request, platform }) => {
		const db = getDB(platform);
		const formData = await request.formData();
		const matricula = formData.get('matricula') as string;

		if (!matricula || typeof matricula !== 'string') {
			return fail(400, { error: 'Matrícula inválida.' });
		}

		const policial = await db.select()
			.from(policiais)
			.where(and(eq(policiais.matricula, matricula.trim()), eq(policiais.ativo, 1)))
			.get();

		const respostaGenerica = { success: true, enviado: true };

		if (!policial) return respostaGenerica;
		if (policial.primeiro_acesso !== 1) return respostaGenerica;
		if (!policial.email) {
			return fail(422, { error: 'Nenhum e-mail cadastrado para esta matrícula.' });
		}

		const senhaProvisoria = gerarSenhaProvisoria();
		const senhaHash = await hashSenha(senhaProvisoria);
		await db.update(policiais).set({ senha: senhaHash }).where(eq(policiais.id, policial.id));

		try {
			await enviarSenhaProvisoria(policial.email, senhaProvisoria, policial.nome, platform);
		} catch (err) {
			console.error('[primeiro-acesso] Falha ao enviar e-mail:', err);
			return fail(500, { error: 'Falha ao enviar e-mail. Tente novamente.' });
		}

		return respostaGenerica;
	}
};
