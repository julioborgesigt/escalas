import { json } from '@sveltejs/kit';
import { getDB } from '$lib/db';
import { hashSenha, validarSessao } from '$lib/auth';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ platform, request, cookies }) => {
	const db = getDB(platform);
	const token = cookies.get('session_token');
	const usuario = await validarSessao(db, token);

	if (!usuario) {
		return json({ error: 'Não autorizado' }, { status: 401 });
	}

	const { senha_atual, nova_senha } = await request.json();

	if (!nova_senha || nova_senha.length !== 8) {
		return json({ error: 'A nova senha deve ter exatamente 8 caracteres' }, { status: 400 });
	}

	if (nova_senha === '12345678') {
		return json({ error: 'Escolha uma senha diferente da padrão' }, { status: 400 });
	}

	// Verificar senha atual (exceto no primeiro acesso)
	if (!usuario.primeiro_acesso) {
		if (!senha_atual) {
			return json({ error: 'Senha atual é obrigatória' }, { status: 400 });
		}
		const senhaAtualHash = await hashSenha(senha_atual);
		const tabela = usuario.tipo === 'admin' ? 'administradores' : 'policiais';
		const campo = usuario.tipo === 'admin' ? 'login' : 'matricula';
		const identificador = usuario.tipo === 'admin' ? 'admin' : usuario.matricula;

		const registro = await db.prepare(
			`SELECT id FROM ${tabela} WHERE id = ? AND senha = ?`
		).bind(usuario.id, senhaAtualHash).first();

		if (!registro) {
			return json({ error: 'Senha atual incorreta' }, { status: 401 });
		}
	}

	const novaSenhaHash = await hashSenha(nova_senha);

	if (usuario.tipo === 'admin') {
		await db.prepare(
			'UPDATE administradores SET senha = ?, primeiro_acesso = 0 WHERE id = ?'
		).bind(novaSenhaHash, usuario.id).run();
	} else {
		await db.prepare(
			'UPDATE policiais SET senha = ?, primeiro_acesso = 0 WHERE id = ?'
		).bind(novaSenhaHash, usuario.id).run();
	}

	return json({ success: true });
};
