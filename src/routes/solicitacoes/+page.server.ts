import { redirect, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import {
	getDB,
	listarSolicitacoesCadastroPendentes,
	decidirSolicitacaoCadastro,
	registrarAuditComContexto,
	contextoDeEvento
} from '$lib/db';

/**
 * Aba "Solicitações" do Admin Geral: alterações cadastrais pedidas pelos
 * servidores no "Meu perfil", aprovadas (aplica no cadastro) ou rejeitadas
 * com um clique.
 */

export const load: PageServerLoad = async ({ locals, platform }) => {
	const u = locals.usuario;
	if (!u) throw redirect(302, '/login');
	if (u.tipo !== 'admin') throw redirect(302, '/bem-vindo');

	const db = getDB(platform);
	const pendentes = await listarSolicitacoesCadastroPendentes(db);
	return { pendentes };
};

export const actions: Actions = {
	decidir: async (event) => {
		const { request, locals, platform } = event;
		const u = locals.usuario;
		if (!u || u.tipo !== 'admin') return fail(403, { error: 'Apenas o Admin Geral decide' });

		const data = await request.formData();
		const id = Number(data.get('id'));
		const decisao = data.get('decisao')?.toString();
		if (isNaN(id) || (decisao !== 'aprovar' && decisao !== 'rejeitar')) {
			return fail(400, { error: 'Dados inválidos' });
		}

		const db = getDB(platform);
		let sol;
		try {
			sol = await decidirSolicitacaoCadastro(db, id, decisao === 'aprovar', u.id);
		} catch {
			return fail(500, { error: 'Erro ao aplicar a decisão. Tente novamente.' });
		}
		if (!sol) {
			return fail(409, { error: 'Solicitação já decidida por outro administrador.' });
		}

		const { contexto, env } = contextoDeEvento(event);
		await registrarAuditComContexto(db, {
			usuario: u,
			acao: decisao === 'aprovar' ? 'aprovar_alteracao_cadastro' : 'rejeitar_alteracao_cadastro',
			entidade: 'policial',
			entidade_id: sol.policial_id,
			alvo_tipo: 'policial',
			alvo_id: sol.policial_id,
			detalhes: `${decisao === 'aprovar' ? 'Aprovada' : 'Rejeitada'} alteração de ${sol.campo}: "${sol.valor_atual ?? '—'}" → "${sol.valor_novo}"`,
			metadados: { solicitacao_id: sol.id, campo: sol.campo },
			dados_antes: { [sol.campo]: sol.valor_atual },
			dados_depois: decisao === 'aprovar' ? { [sol.campo]: sol.valor_novo } : null,
			...contexto,
			env
		});

		const pendentes = await listarSolicitacoesCadastroPendentes(db);
		return { success: true, pendentes };
	}
};
