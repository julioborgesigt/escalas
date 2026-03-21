import { json } from '@sveltejs/kit';
import { eq, and } from 'drizzle-orm';
import { getDB } from '$lib/db';
import { hashSenha, validarSessao } from '$lib/auth';
import { administradores, policiais } from '$lib/server/schema';
import { alterarSenhaSchema } from '$lib/schemas';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ platform, request, cookies }) => {
	const db = getDB(platform);
	const token = cookies.get('session_token');
	const usuario = await validarSessao(db, token);

	if (!usuario) {
		return json({ error: 'Não autorizado' }, { status: 401 });
	}

	const body = await request.json();
	const parsed = alterarSenhaSchema.safeParse(body);
	if (!parsed.success) {
		return json({ error: parsed.error.issues[0].message }, { status: 400 });
	}

	const { senha_atual, nova_senha } = parsed.data;

	// Verificar senha atual (exceto no primeiro acesso)
	if (!usuario.primeiro_acesso) {
		if (!senha_atual) {
			return json({ error: 'Senha atual é obrigatória' }, { status: 400 });
		}
		const senhaAtualHash = await hashSenha(senha_atual);

		if (usuario.tipo === 'admin') {
			const registro = await db
				.select({ id: administradores.id })
				.from(administradores)
				.where(and(eq(administradores.id, usuario.id), eq(administradores.senha, senhaAtualHash)))
				.get();
			if (!registro) {
				return json({ error: 'Senha atual incorreta' }, { status: 401 });
			}
		} else {
			const registro = await db
				.select({ id: policiais.id })
				.from(policiais)
				.where(and(eq(policiais.id, usuario.id), eq(policiais.senha, senhaAtualHash)))
				.get();
			if (!registro) {
				return json({ error: 'Senha atual incorreta' }, { status: 401 });
			}
		}
	}

	const novaSenhaHash = await hashSenha(nova_senha);

	if (usuario.tipo === 'admin') {
		await db
			.update(administradores)
			.set({ senha: novaSenhaHash, primeiro_acesso: 0 })
			.where(eq(administradores.id, usuario.id));
	} else {
		await db
			.update(policiais)
			.set({ senha: novaSenhaHash, primeiro_acesso: 0 })
			.where(eq(policiais.id, usuario.id));
	}

	return json({ success: true });
};
