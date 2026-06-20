import { fail } from '@sveltejs/kit';
import { eq, and } from 'drizzle-orm';
import { getDB } from '$lib/db';
import { hashSenha, verificarSenha, criarSessao } from '$lib/auth';
import { administradores, policiais, sessoes } from '$lib/server/schema';
import { alterarSenhaSchema } from '$lib/schemas';
import { cookieOptions } from '$lib/server/auth-flow';
import { invalidarSessaoCache } from '$lib/server/session-cache';
import { contarRecoveryAttempts, registrarRecoveryAttempt } from '$lib/server/recovery-rate-limit';
import type { Actions, PageServerLoad } from './$types';

// Throttle da verificação de senha_atual: com uma sessão roubada, este era o
// único caminho de brute-force online ilimitado da senha (para depois trocá-la
// "legitimamente"). Chave POR USUÁRIO (não IP): o atacante já está autenticado.
const SENHA_ATUAL_MAX_TENTATIVAS = 5;
const SENHA_ATUAL_JANELA_MIN = 15;

export const load: PageServerLoad = async ({ locals }) => {
	return {
		primeiro_acesso: locals.usuario?.primeiro_acesso ?? false
	};
};

export const actions = {
	alterar: async ({ request, platform, locals, cookies, url }) => {
		const db = getDB(platform);
		const usuario = locals.usuario;

		if (!usuario) {
			return fail(401, { error: 'Não autorizado' });
		}

		const formData = await request.formData();
		const nova_senha = formData.get('nova_senha')?.toString();
		const senha_atual = formData.get('senha_atual')?.toString();

		const parsed = alterarSenhaSchema.safeParse({
			nova_senha,
			senha_atual: senha_atual || undefined
		});
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

		const pepper = (platform?.env as Env | undefined)?.PASSWORD_PEPPER?.trim() || undefined;

		// Verificar senha atual (exceto no primeiro acesso)
		if (!usuario.primeiro_acesso) {
			if (!senha_atual) {
				return fail(400, { error: 'Senha atual é obrigatória' });
			}

			const chaveThrottle = `senha-atual:${usuario.tipo}:${usuario.id}`;
			const { blocked } = await contarRecoveryAttempts(
				db,
				chaveThrottle,
				'alterar_senha',
				SENHA_ATUAL_JANELA_MIN,
				SENHA_ATUAL_MAX_TENTATIVAS
			);
			if (blocked) {
				return fail(429, {
					error: `Muitas tentativas de senha incorretas. Tente novamente em ${SENHA_ATUAL_JANELA_MIN} minutos.`
				});
			}

			const registro =
				usuario.tipo === 'admin'
					? await db
							.select({ senha: administradores.senha })
							.from(administradores)
							.where(eq(administradores.id, usuario.id))
							.get()
					: await db
							.select({ senha: policiais.senha })
							.from(policiais)
							.where(eq(policiais.id, usuario.id))
							.get();
			if (!registro || !(await verificarSenha(senha_atual, registro.senha, pepper))) {
				await registrarRecoveryAttempt(db, chaveThrottle, 'alterar_senha');
				return fail(401, { error: 'Senha atual incorreta' });
			}
		}

		const novaSenhaHash = await hashSenha(parsed.data.nova_senha, pepper);

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

		// Rotação completa: invalida TODAS as sessões (inclusive a atual) e cria
		// uma nova. Se um atacante tinha o cookie roubado, o `Set-Cookie` novo
		// só vai para o navegador legítimo desta resposta — atacante perde acesso.
		await db
			.delete(sessoes)
			.where(and(eq(sessoes.tipo, usuario.tipo), eq(sessoes.usuario_id, usuario.id)));

		// Higiene do cache edge de sessão: o token antigo ainda valeria por até
		// 60s no colo local. O token NOVO é cache-miss natural (chave diferente),
		// então primeiro_acesso=0 entra em vigor imediatamente.
		await invalidarSessaoCache(cookies.get('session_token'));

		const novoToken = await criarSessao(db, usuario.tipo, usuario.id);
		cookies.set('session_token', novoToken, cookieOptions(url));

		return { success: true };
	}
} satisfies Actions;
