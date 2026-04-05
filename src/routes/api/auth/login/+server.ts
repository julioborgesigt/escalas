import { json } from '@sveltejs/kit';
import { eq, and, gt } from 'drizzle-orm';
import { getDB } from '$lib/db';
import { hashSenha, verificarSenha, isHashLegado, criarSessao, gerarCodigo2FA, criarDesafio2FA } from '$lib/auth';
import { enviarCodigo2FA } from '$lib/server/email';
import { administradores, policiais, loginAttempts } from '$lib/server/schema';
import { loginSchema } from '$lib/schemas';
import type { RequestHandler } from './$types';
import type { Database } from '$lib/db';

const MAX_ATTEMPTS = 5;
const WINDOW_MINUTES = 15;

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

		// 2FA: se o admin tiver e-mail cadastrado, exige verificação
		if (admin.email) {
			const codigo = gerarCodigo2FA();
			const desafioId = await criarDesafio2FA(db, 'admin', admin.id, codigo);
			try {
				await enviarCodigo2FA(admin.email, codigo, admin.nome, platform);
			} catch (err) {
				console.error('[2FA] Falha ao enviar e-mail:', err);
				return json({ error: 'Falha ao enviar código de verificação. Contate o administrador.' }, { status: 500 });
			}
			return json({ pendente2FA: true, desafioId, nome: admin.nome, primeiro_acesso: admin.primeiro_acesso === 1 });
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

	// 2FA: se o policial tiver e-mail cadastrado, exige verificação
	if (policial.email) {
		const codigo = gerarCodigo2FA();
		const desafioId = await criarDesafio2FA(db, 'policial', policial.id, codigo);
		try {
			await enviarCodigo2FA(policial.email, codigo, policial.nome, platform);
		} catch (err) {
			console.error('[2FA] Falha ao enviar e-mail:', err);
			return json({ error: 'Falha ao enviar código de verificação. Contate o administrador.' }, { status: 500 });
		}
		return json({ pendente2FA: true, desafioId, nome: policial.nome, primeiro_acesso: policial.primeiro_acesso === 1 });
	}

	const token = await criarSessao(db, 'policial', policial.id);
	cookies.set('session_token', token, cookieOptions(url));
	return json({ success: true, primeiro_acesso: policial.primeiro_acesso === 1, nome: policial.nome });
};
