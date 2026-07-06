/**
 * Solicitações de alteração cadastral do próprio policial ("Meu perfil").
 *
 * Fluxo: o policial solicita a mudança de telefone/classe/regime/lotação; o
 * Admin Geral aprova (aplica no cadastro) ou rejeita na aba "Solicitações".
 * Uma nova solicitação pendente do MESMO campo substitui a anterior. E-mail
 * pessoal não passa por aqui (fluxo próprio com OTP).
 */

import { and, eq, desc, inArray } from 'drizzle-orm';
import type { Database } from './core';
import { cadastroSolicitacoes, policiais } from '$lib/server/schema';
import type { CadastroSolicitacao } from '$lib/server/schema';
import type { CampoSolicitacao } from '$lib/perfil-campos';

export type { CampoSolicitacao };

/**
 * Registra as mudanças solicitadas (1 linha por campo), substituindo qualquer
 * pendente anterior do mesmo campo do mesmo policial.
 */
export async function criarSolicitacoesCadastro(
	db: Database,
	policialId: number,
	mudancas: Array<{ campo: CampoSolicitacao; valorAtual: string | null; valorNovo: string }>
): Promise<void> {
	if (mudancas.length === 0) return;
	const campos = mudancas.map((m) => m.campo);
	await db
		.delete(cadastroSolicitacoes)
		.where(
			and(
				eq(cadastroSolicitacoes.policial_id, policialId),
				eq(cadastroSolicitacoes.status, 'pendente'),
				inArray(cadastroSolicitacoes.campo, campos)
			)
		);
	await db.insert(cadastroSolicitacoes).values(
		mudancas.map((m) => ({
			policial_id: policialId,
			campo: m.campo,
			valor_atual: m.valorAtual,
			valor_novo: m.valorNovo
		}))
	);
}

/** Solicitações do próprio policial, mais recentes primeiro (histórico curto). */
export async function listarMinhasSolicitacoesCadastro(
	db: Database,
	policialId: number,
	limit = 20
): Promise<CadastroSolicitacao[]> {
	return db
		.select()
		.from(cadastroSolicitacoes)
		.where(eq(cadastroSolicitacoes.policial_id, policialId))
		.orderBy(desc(cadastroSolicitacoes.id))
		.limit(limit)
		.all();
}

export interface SolicitacaoPendenteComPolicial extends CadastroSolicitacao {
	policial_nome: string;
	policial_matricula: string;
	policial_cargo: string;
	policial_lotacao: string;
}

/** Pendentes para a aba "Solicitações" do Admin Geral, com dados do policial. */
export async function listarSolicitacoesCadastroPendentes(
	db: Database
): Promise<SolicitacaoPendenteComPolicial[]> {
	const rows = await db
		.select({
			id: cadastroSolicitacoes.id,
			policial_id: cadastroSolicitacoes.policial_id,
			campo: cadastroSolicitacoes.campo,
			valor_atual: cadastroSolicitacoes.valor_atual,
			valor_novo: cadastroSolicitacoes.valor_novo,
			status: cadastroSolicitacoes.status,
			decidido_por: cadastroSolicitacoes.decidido_por,
			decidido_em: cadastroSolicitacoes.decidido_em,
			created_at: cadastroSolicitacoes.created_at,
			policial_nome: policiais.nome,
			policial_matricula: policiais.matricula,
			policial_cargo: policiais.cargo,
			policial_lotacao: policiais.lotacao
		})
		.from(cadastroSolicitacoes)
		.innerJoin(policiais, eq(policiais.id, cadastroSolicitacoes.policial_id))
		.where(eq(cadastroSolicitacoes.status, 'pendente'))
		.orderBy(desc(cadastroSolicitacoes.id))
		.all();
	return rows as SolicitacaoPendenteComPolicial[];
}

/**
 * Decide uma solicitação pendente. Aprovação APLICA o valor no cadastro do
 * policial no mesmo batch (D1) da mudança de status — ou tudo ou nada.
 * Devolve a solicitação decidida ou `null` se não estava mais pendente.
 */
export async function decidirSolicitacaoCadastro(
	db: Database,
	solicitacaoId: number,
	aprovar: boolean,
	adminId: number
): Promise<CadastroSolicitacao | null> {
	const sol = await db
		.select()
		.from(cadastroSolicitacoes)
		.where(
			and(eq(cadastroSolicitacoes.id, solicitacaoId), eq(cadastroSolicitacoes.status, 'pendente'))
		)
		.get();
	if (!sol) return null;

	const updateStatus = db
		.update(cadastroSolicitacoes)
		.set({
			status: aprovar ? 'aprovada' : 'rejeitada',
			decidido_por: adminId,
			decidido_em: new Date().toISOString()
		})
		.where(eq(cadastroSolicitacoes.id, solicitacaoId));

	if (!aprovar) {
		await updateStatus;
		return sol;
	}

	const aplicar = db
		.update(policiais)
		.set({ [sol.campo]: sol.valor_novo, updated_at: new Date().toISOString() })
		.where(eq(policiais.id, sol.policial_id));

	await db.batch([updateStatus, aplicar]);
	return sol;
}
