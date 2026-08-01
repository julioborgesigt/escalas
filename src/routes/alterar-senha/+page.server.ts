import { fail } from '@sveltejs/kit';
import { eq, and } from 'drizzle-orm';
import { getDB, auditar, contextoDeEvento } from '$lib/db';
import { hashSenha, verificarSenha, criarSessao } from '$lib/auth';
import { administradores, policiais, sessoes } from '$lib/server/schema';
import { alterarSenhaSchema } from '$lib/schemas';
import { cookieOptions } from '$lib/server/auth/auth-flow';
import { invalidarSessaoCache } from '$lib/server/auth/session-cache';
import {
	contarRecoveryAttempts,
	registrarRecoveryAttempt
} from '$lib/server/auth/recovery-rate-limit';
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
	alterar: async (event) => {
		const { request, platform, locals, cookies, url } = event;
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

		// Admin Geral VINCULADO: a credencial vive na linha de `policiais`. Em modo
		// admin, operações de senha miram o policial vinculado (adminPolicialId),
		// não a linha admin (que tem só um placeholder).
		const alvoEhPolicial = usuario.tipo === 'policial' || usuario.adminPolicialId != null;
		const alvoId = usuario.adminPolicialId ?? usuario.id;

		if (usuario.primeiro_acesso) {
			const registroEmail = alvoEhPolicial
				? await db
						.select({ email_pessoal_verificado: policiais.email_pessoal_verificado })
						.from(policiais)
						.where(eq(policiais.id, alvoId))
						.get()
				: await db
						.select({ email_pessoal_verificado: administradores.email_pessoal_verificado })
						.from(administradores)
						.where(eq(administradores.id, alvoId))
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

			const registro = alvoEhPolicial
				? await db
						.select({ senha: policiais.senha })
						.from(policiais)
						.where(eq(policiais.id, alvoId))
						.get()
				: await db
						.select({ senha: administradores.senha })
						.from(administradores)
						.where(eq(administradores.id, alvoId))
						.get();
			if (!registro || !(await verificarSenha(senha_atual, registro.senha, pepper))) {
				await registrarRecoveryAttempt(db, chaveThrottle, 'alterar_senha');
				return fail(401, { error: 'Senha atual incorreta' });
			}
		}

		const novaSenhaHash = await hashSenha(parsed.data.nova_senha, pepper);

		if (alvoEhPolicial) {
			await db
				.update(policiais)
				.set({ senha: novaSenhaHash, primeiro_acesso: 0 })
				.where(eq(policiais.id, alvoId));
		} else {
			await db
				.update(administradores)
				.set({ senha: novaSenhaHash, primeiro_acesso: 0 })
				.where(eq(administradores.id, alvoId));
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

		const { contexto, env } = contextoDeEvento(event);
		await auditar(
			db,
			{
				acao: 'alterar_senha',
				usuario,
				entidade: alvoEhPolicial ? 'policial' : 'admin',
				entidade_id: alvoId,
				alvo_tipo: alvoEhPolicial ? 'policial' : 'admin',
				alvo_id: alvoId,
				alvo_nome: usuario.nome,
				detalhes: usuario.primeiro_acesso
					? 'Senha definida no primeiro acesso'
					: 'Senha alterada pelo próprio usuário',
				metadados: { primeiro_acesso: usuario.primeiro_acesso },
				...contexto
			},
			{ env }
		);

		return { success: true };
	}
} satisfies Actions;
