import { redirect, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { eq, and, gt } from 'drizzle-orm';
import { getDB, registrarAuditComContexto } from '$lib/db';
import { hashSenha, verificarSenha, isHashLegado, criarSessao, gerarCodigo2FA, criarDesafio2FA, verificarDesafio2FA } from '$lib/auth';
import { enviarCodigo2FA, enviarSenhaProvisoria } from '$lib/server/email';
import { administradores, policiais, loginAttempts } from '$lib/server/schema';
import { superValidate, message } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { loginSchema, primeiroAcessoSchema, verificar2FASchema } from '$lib/schemas/auth';

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
		sameSite: 'lax' as const,
		secure: url.protocol === 'https:',
		maxAge: 12 * 60 * 60
	};
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
	
	const loginForm = await superValidate(zod4(loginSchema));
	const primeiroAcessoForm = await superValidate(zod4(primeiroAcessoSchema));
	const verificar2FAForm = await superValidate(zod4(verificar2FASchema));

	return {
		loginForm,
		primeiroAcessoForm,
		verificar2FAForm
	};
};

export const actions: Actions = {
	login: async ({ request, cookies, platform, url }) => {
		const db = getDB(platform);
		const ip = url.searchParams.get('ip') || 'unknown';
		
		const form = await superValidate(request, zod4(loginSchema));
		if (!form.valid) {
			return fail(400, { form });
		}

		const { matricula, senha, tipo } = form.data;

		const rateLimit = await checkRateLimit(db, ip);
		if (rateLimit.blocked) {
			return message(form, JSON.stringify({ type: 'error', error: `Muitas tentativas. Tente em ${WINDOW_MINUTES} minutos.` }), { status: 429 });
		}

		if (tipo === 'admin') {
			const _env = (platform as { env?: Record<string, string> } | undefined)?.env ?? {};
			const envLogin = _env.ADMIN_GERAL_LOGIN?.trim() ?? '';
			const envSenha = _env.ADMIN_GERAL_SENHA ?? '';

			if (envLogin && envSenha && matricula === envLogin) {
				if (senha !== envSenha) {
					await recordAttempt(db, ip, false);
					await registrarAuditComContexto(db, {
						usuario: null,
						acao: 'falha_login',
						entidade: 'admin',
						detalhes: `Tentativa falha para admin geral: ${matricula}`,
						ip
					});
					return message(form, JSON.stringify({ type: 'error', error: 'Login ou senha inválidos' }), { status: 401 });
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
				if (!envAdmin) return message(form, JSON.stringify({ type: 'error', error: 'Erro ao inicializar administrador.' }), { status: 500 });
				await recordAttempt(db, ip, true);
				const token = await criarSessao(db, 'admin', envAdmin.id);
				cookies.set('session_token', token, cookieOptions(url));
				return message(form, JSON.stringify({ type: 'success', redirect: '/painel', primeiro_acesso: false }));
			}

			const admin = await db.select().from(administradores).where(eq(administradores.login, matricula)).get();
			if (!admin || !(await verificarSenha(senha, admin.senha))) {
				await recordAttempt(db, ip, false);
				return message(form, JSON.stringify({ type: 'error', error: 'Login ou senha inválidos' }), { status: 401 });
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
					return message(form, JSON.stringify({ type: 'error', error: 'Falha ao enviar código de verificação.' }), { status: 500 });
				}
				return message(form, JSON.stringify({
					type: 'success',
					pendente2FA: true,
					desafioId,
					emailMascarado: mascararEmail(admin.email),
					tipoUsuario2FA: 'admin'
				}));
			}

			const token = await criarSessao(db, 'admin', admin.id);
			cookies.set('session_token', token, cookieOptions(url));
			return message(form, JSON.stringify({ type: 'success', redirect: admin.primeiro_acesso === 1 ? '/alterar-senha' : '/painel' }));
		}

		// Policial
		const policial = await db.select().from(policiais).where(and(eq(policiais.matricula, matricula), eq(policiais.ativo, 1))).get();
		if (!policial || !(await verificarSenha(senha, policial.senha))) {
			await recordAttempt(db, ip, false);
			return message(form, JSON.stringify({ type: 'error', error: 'Matrícula ou senha inválidos' }), { status: 401 });
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
				return message(form, JSON.stringify({ type: 'error', error: 'Falha ao enviar código de verificação.' }), { status: 500 });
			}
			return message(form, JSON.stringify({
				type: 'success',
				pendente2FA: true,
				desafioId,
				emailMascarado: mascararEmail(policial.email),
				tipoUsuario2FA: 'policial'
			}));
		}

		const token = await criarSessao(db, 'policial', policial.id);
		cookies.set('session_token', token, cookieOptions(url));
		return message(form, JSON.stringify({ type: 'success', redirect: policial.primeiro_acesso === 1 ? '/alterar-senha' : '/escalas' }));
	},

	verificar2FA: async ({ request, cookies, platform, url }) => {
		const db = getDB(platform);
		const form = await superValidate(request, zod4(verificar2FASchema));
		if (!form.valid) return fail(400, { form });

		const desafioId = form.data.desafioId;
		const codigo = form.data.codigo;

		const resultado = await verificarDesafio2FA(db, desafioId, codigo);

		if (resultado === 'expirado') {
			return message(form, JSON.stringify({ type: 'error', error: 'Código expirado. Faça login novamente.', expirado: true }), { status: 401 });
		}
		if (resultado === 'esgotado') {
			return message(form, JSON.stringify({ type: 'error', error: 'Muitas tentativas incorretas. Faça login novamente.', esgotado: true }), { status: 429 });
		}
		if (!resultado) {
			return message(form, JSON.stringify({ type: 'error', error: 'Código inválido. Verifique e tente novamente.' }), { status: 401 });
		}

		const { tipo, usuarioId } = resultado;
		const tipoSessao = tipo as 'policial' | 'admin';

		let primeiroAcesso = false;
		if (tipoSessao === 'admin') {
			const admin = await db.select().from(administradores).where(eq(administradores.id, usuarioId)).get();
			if (!admin) return message(form, JSON.stringify({ type: 'error', error: 'Usuário não encontrado' }), { status: 404 });
			primeiroAcesso = admin.primeiro_acesso === 1;
		} else {
			const policial = await db.select().from(policiais).where(eq(policiais.id, usuarioId)).get();
			if (!policial || policial.ativo === 0) return message(form, JSON.stringify({ type: 'error', error: 'Usuário inativo' }), { status: 403 });
			primeiroAcesso = policial.primeiro_acesso === 1;
		}

		const token = await criarSessao(db, tipoSessao, usuarioId);
		cookies.set('session_token', token, cookieOptions(url));

		return message(form, JSON.stringify({ type: 'success', redirect: primeiroAcesso ? '/alterar-senha' : '/escalas' }));
	},

	solicitarPrimeiroAcesso: async ({ request, platform }) => {
		const db = getDB(platform);
		const form = await superValidate(request, zod4(primeiroAcessoSchema));
		if (!form.valid) return fail(400, { form });

		const matricula = form.data.matricula;

		const policial = await db.select()
			.from(policiais)
			.where(and(eq(policiais.matricula, matricula.trim()), eq(policiais.ativo, 1)))
			.get();

		const respostaGenerica = JSON.stringify({ type: 'success', enviado: true });

		if (!policial) return message(form, respostaGenerica);
		if (policial.primeiro_acesso !== 1) return message(form, respostaGenerica);
		if (!policial.email) {
			return message(form, JSON.stringify({ type: 'error', error: 'Nenhum e-mail cadastrado para esta matrícula.' }), { status: 422 });
		}

		const senhaProvisoria = gerarSenhaProvisoria();
		const senhaHash = await hashSenha(senhaProvisoria);
		await db.update(policiais).set({ senha: senhaHash }).where(eq(policiais.id, policial.id));

		try {
			await enviarSenhaProvisoria(policial.email, senhaProvisoria, policial.nome, platform);
		} catch (err) {
			console.error('[primeiro-acesso] Falha ao enviar e-mail:', err);
			return message(form, JSON.stringify({ type: 'error', error: 'Falha ao enviar e-mail. Tente novamente.' }), { status: 500 });
		}

		return message(form, respostaGenerica);
	}
};
