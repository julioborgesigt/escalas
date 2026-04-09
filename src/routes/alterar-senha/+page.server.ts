import { fail } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { getDB } from '$lib/db';
import { hashSenha, verificarSenha, invalidarOutrasSessoes } from '$lib/auth';
import { administradores, policiais } from '$lib/server/schema';
import { alterarSenhaSchema } from '$lib/schemas';
import type { Actions, PageServerLoad } from './$types';
import { superValidate, message } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';

export const load: PageServerLoad = async () => {
	const form = await superValidate(zod4(alterarSenhaSchema));
	return { form };
};

export const actions: Actions = {
	alterar: async ({ request, platform, locals, cookies }) => {
		const db = getDB(platform);
		const usuario = locals.usuario;
		const token = cookies.get('session_token');

		if (!usuario) {
			return fail(401, { error: 'Não autorizado' });
		}

		const form = await superValidate(request, zod4(alterarSenhaSchema));

		if (!form.valid) {
			return fail(400, { form });
		}

		const nova_senha = form.data.nova_senha;
		const senha_atual = form.data.senha_atual;

		// Verificar senha atual (exceto no primeiro acesso)
		if (!usuario.primeiro_acesso) {
			if (!senha_atual) {
				return message(form, JSON.stringify({ type: 'error', error: 'Senha atual é obrigatória' }), { status: 400 });
			}

			if (usuario.tipo === 'admin') {
				const registro = await db
					.select({ senha: administradores.senha })
					.from(administradores)
					.where(eq(administradores.id, usuario.id))
					.get();
				if (!registro || !(await verificarSenha(senha_atual, registro.senha))) {
					return message(form, JSON.stringify({ type: 'error', error: 'Senha atual incorreta' }), { status: 401 });
				}
			} else {
				const registro = await db
					.select({ senha: policiais.senha })
					.from(policiais)
					.where(eq(policiais.id, usuario.id))
					.get();
				if (!registro || !(await verificarSenha(senha_atual, registro.senha))) {
					return message(form, JSON.stringify({ type: 'error', error: 'Senha atual incorreta' }), { status: 401 });
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

		if (token) {
			await invalidarOutrasSessoes(db, usuario.tipo, usuario.id, token);
		}

		return message(form, JSON.stringify({ type: 'success' }));
	}
};
