import { json } from '@sveltejs/kit';
import { eq, and, gt } from 'drizzle-orm';
import { getDB, registrarAuditComContexto } from '$lib/db';
import { hashSenha, verificarSenha, isHashLegado, criarSessao, gerarCodigo2FA, criarDesafio2FA } from '$lib/auth';
import { enviarCodigo2FA } from '$lib/server/email';
import { administradores, policiais, loginAttempts } from '$lib/server/schema';
import { loginSchema } from '$lib/schemas';
import type { RequestHandler } from './$types';
import type { Database } from '$lib/db';

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

async function checkRateLimit(db: Database, ip: string): Promise<{ blocked: boolean; remaining: number }> {
	const windowStart = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000).toISOString();
	const attempts = await db
		.select()
		.from(loginAttempts)
		.where(and(eq(loginAttempts.ip, ip), gt(loginAttempts.attempted_at, windowStart), eq(loginAttempts.success, 0)))
		.all();
	const count = attempts.length;
	return { blocked: count >= MAX_ATTEMPTS, remaining: Math.max(0, MAX_ATTEMPTS - count) };
}

async function recordAttempt(db: Database, ip: string, success: boolean): Promise<void> {
	await db.insert(loginAttempts).values({ ip, success: success ? 1 : 0 });
}

export const POST: RequestHandler = async ({ platform, request, cookies, url, getClientAddress }) => {
	const db = getDB(platform);
	const ip = getClientAddress();
	const body = await request.json();

	const parsed = loginSchema.safeParse(body);
	if (!parsed.success) {
		return json({ error: parsed.error.issues[0].message }, { status: 400 });
	}

	// Rate limiting: verificar tentativas do IP
	const rateLimit = await checkRateLimit(db, ip);
	if (rateLimit.blocked) {
		return json(
			{ error: `Muitas tentativas de login. Tente novamente em ${WINDOW_MINUTES} minutos.` },
			{ status: 429 }
		);
	}

	const { matricula, senha, tipo } = parsed.data;

	if (tipo === 'admin') {
		// --- Admin Geral via variáveis de ambiente ---
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
				return json({ error: 'Login ou senha inválidos' }, { status: 401 });
			}
			// Busca ou cria o registro no DB (necessário para a sessão)
			let envAdmin = await db
				.select()
				.from(administradores)
				.where(eq(administradores.login, envLogin))
				.get();
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
			if (!envAdmin) return json({ error: 'Erro ao inicializar administrador.' }, { status: 500 });
			await recordAttempt(db, ip, true);
			const token = await criarSessao(db, 'admin', envAdmin.id);
			cookies.set('session_token', token, cookieOptions(url));
			return json({ success: true, primeiro_acesso: false, nome: envAdmin.nome });
		}
		// --- Fim admin geral via env ---

		const admin = await db
			.select()
			.from(administradores)
			.where(eq(administradores.login, matricula))
			.get();

		if (!admin || !(await verificarSenha(senha, admin.senha))) {
			await recordAttempt(db, ip, false);
			return json({ error: 'Login ou senha inválidos' }, { status: 401 });
		}

		// Migração transparente: se o hash é legado (SHA-256), atualiza para PBKDF2
		if (isHashLegado(admin.senha)) {
			const novoHash = await hashSenha(senha);
			await db.update(administradores).set({ senha: novoHash }).where(eq(administradores.id, admin.id));
		}

		await recordAttempt(db, ip, true);

		// 2FA: exige verificação apenas se não for primeiro acesso
		if (admin.email && admin.primeiro_acesso !== 1) {
			const codigo = gerarCodigo2FA();
			const desafioId = await criarDesafio2FA(db, 'admin', admin.id, codigo);
			try {
				await enviarCodigo2FA(admin.email, codigo, admin.nome, platform);
			} catch (err) {
				console.error('[2FA] Falha ao enviar e-mail:', err);
				return json({ error: 'Falha ao enviar código de verificação. Contate o administrador.' }, { status: 500 });
			}
			return json({ pendente2FA: true, desafioId, nome: admin.nome, primeiro_acesso: admin.primeiro_acesso === 1, emailMascarado: mascararEmail(admin.email) });
		}

		const token = await criarSessao(db, 'admin', admin.id);
		cookies.set('session_token', token, cookieOptions(url));
		return json({ success: true, primeiro_acesso: admin.primeiro_acesso === 1, nome: admin.nome });
	}

	// Login de policial
	const policial = await db
		.select()
		.from(policiais)
		.where(and(eq(policiais.matricula, matricula), eq(policiais.ativo, 1)))
		.get();

	if (!policial || !(await verificarSenha(senha, policial.senha))) {
		await recordAttempt(db, ip, false);
		return json({ error: 'Matrícula ou senha inválidos' }, { status: 401 });
	}

	// Migração transparente: se o hash é legado (SHA-256), atualiza para PBKDF2
	if (isHashLegado(policial.senha)) {
		const novoHash = await hashSenha(senha);
		await db.update(policiais).set({ senha: novoHash }).where(eq(policiais.id, policial.id));
	}

	await recordAttempt(db, ip, true);

	// 2FA: exige verificação apenas se NÃO for primeiro acesso (já verificou via e-mail ao receber senha provisória)
	if (policial.email && policial.primeiro_acesso !== 1) {
		const codigo = gerarCodigo2FA();
		const desafioId = await criarDesafio2FA(db, 'policial', policial.id, codigo);
		try {
			await enviarCodigo2FA(policial.email, codigo, policial.nome, platform);
		} catch (err) {
			console.error('[2FA] Falha ao enviar e-mail:', err);
			return json({ error: 'Falha ao enviar código de verificação. Contate o administrador.' }, { status: 500 });
		}
		return json({ pendente2FA: true, desafioId, nome: policial.nome, primeiro_acesso: policial.primeiro_acesso === 1, emailMascarado: mascararEmail(policial.email) });
	}

	const token = await criarSessao(db, 'policial', policial.id);
	cookies.set('session_token', token, cookieOptions(url));
	return json({ success: true, primeiro_acesso: policial.primeiro_acesso === 1, nome: policial.nome });
};
