import { json } from '@sveltejs/kit';
import { eq, and } from 'drizzle-orm';
import { getDB } from '$lib/db';
import { hashSenha, verificarSenha, isHashLegado, criarSessao } from '$lib/auth';
import { administradores, policiais } from '$lib/server/schema';
import { loginSchema } from '$lib/schemas';
import type { RequestHandler } from './$types';

function cookieOptions(url: URL) {
	return {
		path: '/',
		httpOnly: true,
		sameSite: 'lax' as const,
		secure: url.protocol === 'https:',
		maxAge: 12 * 60 * 60
	};
}

export const POST: RequestHandler = async ({ platform, request, cookies, url }) => {
	const db = getDB(platform);
	const body = await request.json();

	const parsed = loginSchema.safeParse(body);
	if (!parsed.success) {
		return json({ error: parsed.error.issues[0].message }, { status: 400 });
	}

	const { matricula, senha, tipo } = parsed.data;

	if (tipo === 'admin') {
		const admin = await db
			.select()
			.from(administradores)
			.where(eq(administradores.login, matricula))
			.get();

		if (!admin || !(await verificarSenha(senha, admin.senha))) {
			return json({ error: 'Login ou senha inválidos' }, { status: 401 });
		}

		// Migração transparente: se o hash é legado (SHA-256), atualiza para PBKDF2
		if (isHashLegado(admin.senha)) {
			const novoHash = await hashSenha(senha);
			await db.update(administradores).set({ senha: novoHash }).where(eq(administradores.id, admin.id));
		}

		const token = await criarSessao(db, 'admin', admin.id);
		cookies.set('session_token', token, cookieOptions(url));

		return json({
			success: true,
			primeiro_acesso: admin.primeiro_acesso === 1,
			nome: admin.nome
		});
	}

	// Login de policial
	const policial = await db
		.select()
		.from(policiais)
		.where(and(eq(policiais.matricula, matricula), eq(policiais.ativo, 1)))
		.get();

	if (!policial || !(await verificarSenha(senha, policial.senha))) {
		return json({ error: 'Matrícula ou senha inválidos' }, { status: 401 });
	}

	// Migração transparente: se o hash é legado (SHA-256), atualiza para PBKDF2
	if (isHashLegado(policial.senha)) {
		const novoHash = await hashSenha(senha);
		await db.update(policiais).set({ senha: novoHash }).where(eq(policiais.id, policial.id));
	}

	const token = await criarSessao(db, 'policial', policial.id);
	cookies.set('session_token', token, cookieOptions(url));

	return json({
		success: true,
		primeiro_acesso: policial.primeiro_acesso === 1,
		nome: policial.nome
	});
};
