import { fail, redirect } from '@sveltejs/kit';
import { eq, and } from 'drizzle-orm';
import { getDB, registrarAuditComContexto } from '$lib/db';
import { verificarTokenRedefinicao, hashSenha } from '$lib/auth';
import { administradores, policiais, sessoes, resetSenhaTokens } from '$lib/server/schema';
import { alterarSenhaSchema } from '$lib/schemas';
import type { PageServerLoad, Actions } from './$types';

export const load: PageServerLoad = async ({ url, platform }) => {
	const token = url.searchParams.get('token') ?? '';

	if (!token) {
		return { valido: false, erro: 'Link inválido ou ausente.', token: '' };
	}

	const db = getDB(platform);
	const resultado = await verificarTokenRedefinicao(db, token);

	if (resultado === 'invalido') {
		return { valido: false, erro: 'Este link é inválido ou já foi utilizado.', token };
	}
	if (resultado === 'expirado') {
		return { valido: false, erro: 'Este link expirou. Solicite um novo link de redefinição.', token };
	}

	return { valido: true, erro: null, token };
};

export const actions: Actions = {
	redefinir: async ({ request, platform, getClientAddress }) => {
		const formData = await request.formData();
		const token = formData.get('token')?.toString() ?? '';
		const nova_senha = formData.get('nova_senha')?.toString() ?? '';
		const confirmar_senha = formData.get('confirmar_senha')?.toString() ?? '';

		if (!token) {
			return fail(400, { error: 'Token ausente' });
		}

		if (nova_senha !== confirmar_senha) {
			return fail(400, { error: 'As senhas não conferem.' });
		}

		const parsed = alterarSenhaSchema.safeParse({ nova_senha });
		if (!parsed.success) {
			return fail(400, { error: parsed.error.issues[0].message });
		}

		const db = getDB(platform);

		// Dupla verificação do token
		const resultado = await verificarTokenRedefinicao(db, token);
		if (resultado === 'expirado') {
			return fail(400, { error: 'Este link expirou. Solicite um novo link de redefinição.' });
		}
		if (resultado === 'invalido') {
			return fail(400, { error: 'Este link é inválido ou já foi utilizado.' });
		}

		const { tipo, usuarioId } = resultado;

		// Marcar token como usado ANTES de alterar a senha (previne race condition)
		await db
			.update(resetSenhaTokens)
			.set({ usado: 1 })
			.where(eq(resetSenhaTokens.token, token));

		const novaSenhaHash = await hashSenha(parsed.data.nova_senha);

		// Buscar nome para auditoria
		let nome = 'Usuário';

		if (tipo === 'admin') {
			const admin = await db
				.select({ nome: administradores.nome })
				.from(administradores)
				.where(eq(administradores.id, usuarioId))
				.get();
			nome = admin?.nome ?? nome;

			await db
				.update(administradores)
				.set({ senha: novaSenhaHash, primeiro_acesso: 0 })
				.where(eq(administradores.id, usuarioId));
		} else {
			const policial = await db
				.select({ nome: policiais.nome })
				.from(policiais)
				.where(eq(policiais.id, usuarioId))
				.get();
			nome = policial?.nome ?? nome;

			await db
				.update(policiais)
				.set({ senha: novaSenhaHash, primeiro_acesso: 0 })
				.where(eq(policiais.id, usuarioId));
		}

		// Invalidar todas as sessões do usuário
		await db
			.delete(sessoes)
			.where(and(eq(sessoes.tipo, tipo), eq(sessoes.usuario_id, usuarioId)));

		// Auditoria
		await registrarAuditComContexto(db, {
			usuario: { id: usuarioId, nome },
			acao: 'redefinir_senha',
			entidade: tipo === 'policial' ? 'policiais' : 'administradores',
			entidade_id: usuarioId,
			ip: getClientAddress()
		});

		throw redirect(303, '/login?resetado=1');
	}
};
