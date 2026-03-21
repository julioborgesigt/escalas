import { json } from '@sveltejs/kit';
import { eq, and } from 'drizzle-orm';
import { getDB } from '$lib/db';
import { hashSenha, criarSessao } from '$lib/auth';
import { administradores, policiais } from '$lib/server/schema';
import { loginSchema } from '$lib/schemas';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ platform, request, cookies }) => {
	const db = getDB(platform);
	const body = await request.json();

	const parsed = loginSchema.safeParse(body);
	if (!parsed.success) {
		return json({ error: parsed.error.issues[0].message }, { status: 400 });
	}

	const { matricula, senha, tipo } = parsed.data;
	const senhaHash = await hashSenha(senha);

	if (tipo === 'admin') {
		const admin = await db
			.select()
			.from(administradores)
			.where(and(eq(administradores.login, matricula), eq(administradores.senha, senhaHash)))
			.get();

		if (!admin) {
			return json({ error: 'Login ou senha inválidos' }, { status: 401 });
		}

		const token = await criarSessao(db, 'admin', admin.id);
		cookies.set('session_token', token, {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			secure: false,
			maxAge: 7 * 24 * 60 * 60
		});

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
		.where(
			and(eq(policiais.matricula, matricula), eq(policiais.senha, senhaHash), eq(policiais.ativo, 1))
		)
		.get();

	if (!policial) {
		return json({ error: 'Matrícula ou senha inválidos' }, { status: 401 });
	}

	const token = await criarSessao(db, 'policial', policial.id);
	cookies.set('session_token', token, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: false,
		maxAge: 7 * 24 * 60 * 60
	});

	return json({
		success: true,
		primeiro_acesso: policial.primeiro_acesso === 1,
		nome: policial.nome
	});
};
