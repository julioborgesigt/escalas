import { fail } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { getDB } from '$lib/db';
import { hashSenha, verificarSenha, invalidarOutrasSessoes } from '$lib/auth';
import { administradores, policiais } from '$lib/server/schema';
import { alterarSenhaSchema } from '$lib/schemas';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	return {
		primeiro_acesso: locals.usuario?.primeiro_acesso ?? false
	};
};

export const actions = {
	alterar: async ({ request, platform, locals, cookies }) => {
		const db = getDB(platform);
		const usuario = locals.usuario;
		const token = cookies.get('session_token');

		if (!usuario) {
			return fail(401, { error: 'Não autorizado' });
		}

		const formData = await request.formData();
		const nova_senha = formData.get('nova_senha')?.toString();
		const senha_atual = formData.get('senha_atual')?.toString();

		const parsed = alterarSenhaSchema.safeParse({ nova_senha, senha_atual: senha_atual || undefined });
		if (!parsed.success) {
			return fail(400, { error: parsed.error.issues[0].message });
		}

		if (usuario.primeiro_acesso) {
			const registroEmail =
				usuario.tipo === 'admin'
					? await db
							.select({ email_pessoal_verificado: administradores.email_pessoal_verificado })
							.from(administradores)
							.where(eq(administradores.id, usuario.id))
							.get()
					: await db
							.select({ email_pessoal_verificado: policiais.email_pessoal_verificado })
							.from(policiais)
							.where(eq(policiais.id, usuario.id))
							.get();

			if (!registroEmail || registroEmail.email_pessoal_verificado !== 1) {
				return fail(400, {
					error: 'Confirme seu e-mail pessoal antes de concluir o primeiro acesso.'
				});
			}
		}

		// Verificar senha atual (exceto no primeiro acesso)
		if (!usuario.primeiro_acesso) {
			if (!senha_atual) {
				return fail(400, { error: 'Senha atual é obrigatória' });
			}

			if (usuario.tipo === 'admin') {
				const registro = await db
					.select({ senha: administradores.senha })
					.from(administradores)
					.where(eq(administradores.id, usuario.id))
					.get();
				if (!registro || !(await verificarSenha(senha_atual, registro.senha, db))) {
					return fail(401, { error: 'Senha atual incorreta' });
				}
			} else {
				const registro = await db
					.select({ senha: policiais.senha })
					.from(policiais)
					.where(eq(policiais.id, usuario.id))
					.get();
				if (!registro || !(await verificarSenha(senha_atual, registro.senha, db))) {
					return fail(401, { error: 'Senha atual incorreta' });
				}
			}
		}

		const novaSenhaHash = await hashSenha(parsed.data.nova_senha);

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

		if (token) {
			await invalidarOutrasSessoes(db, usuario.tipo, usuario.id, token);
		}

		return { success: true };
	}
} satisfies Actions;
