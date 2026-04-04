import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { getDB } from '$lib/db';
import { hashSenha, verificarSenha, validarSessao, invalidarOutrasSessoes } from '$lib/auth';
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

		if (usuario.tipo === 'admin') {
			const registro = await db
				.select({ senha: administradores.senha })
				.from(administradores)
				.where(eq(administradores.id, usuario.id))
				.get();
			if (!registro || !(await verificarSenha(senha_atual, registro.senha))) {
				return json({ error: 'Senha atual incorreta' }, { status: 401 });
			}
		} else {
			const registro = await db
				.select({ senha: policiais.senha })
				.from(policiais)
				.where(eq(policiais.id, usuario.id))
				.get();
			if (!registro || !(await verificarSenha(senha_atual, registro.senha))) {
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

	// Invalidar todas as outras sessões (forçar re-login em outros dispositivos)
	await invalidarOutrasSessoes(db, usuario.tipo, usuario.id, token!);

	return json({ success: true });
};
