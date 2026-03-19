import { json } from '@sveltejs/kit';
import { getDB } from '$lib/db';
import { hashSenha, criarSessao } from '$lib/auth';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ platform, request, cookies }) => {
	const db = getDB(platform);
	const { matricula, senha, tipo } = await request.json();

	if (!matricula || !senha) {
		return json({ error: 'Matrícula e senha são obrigatórios' }, { status: 400 });
	}

	const senhaHash = await hashSenha(senha);

	if (tipo === 'admin') {
		const admin = await db.prepare(
			'SELECT * FROM administradores WHERE login = ? AND senha = ?'
		).bind(matricula, senhaHash).first<{ id: number; nome: string; primeiro_acesso: number }>();

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
	const policial = await db.prepare(
		'SELECT * FROM policiais WHERE matricula = ? AND senha = ? AND ativo = 1'
	).bind(matricula, senhaHash).first<{
		id: number; nome: string; primeiro_acesso: number; lotacao: string;
	}>();

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
