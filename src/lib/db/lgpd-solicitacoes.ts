import { desc, eq, and } from 'drizzle-orm';
import { lgpdSolicitacoes } from '../server/schema';
import type { Database } from './core';
import type { LgpdSolicitacao } from '../server/schema';

type TipoDireitoLgpd =
	| 'acesso'
	| 'correcao'
	| 'anonimizacao'
	| 'portabilidade'
	| 'eliminacao'
	| 'informacao_compartilhamento'
	| 'revogacao_consentimento'
	| 'oposicao';

type StatusSolicitacao = 'pendente' | 'em_analise' | 'concluida' | 'indeferida';

interface NovaSolicitacaoInput {
	solicitante_tipo: 'policial' | 'admin';
	solicitante_id: number;
	solicitante_nome: string;
	tipo_direito: TipoDireitoLgpd;
	descricao?: string | null;
}

/** Prazo: 15 dias úteis ≈ 21 dias corridos (art. 18, §5º, LGPD). */
function calcularPrazoResposta(): string {
	const d = new Date();
	d.setDate(d.getDate() + 21);
	return d.toISOString().slice(0, 10);
}

export async function criarSolicitacao(
	db: Database,
	input: NovaSolicitacaoInput
): Promise<LgpdSolicitacao> {
	return db
		.insert(lgpdSolicitacoes)
		.values({
			solicitante_tipo: input.solicitante_tipo,
			solicitante_id: input.solicitante_id,
			solicitante_nome: input.solicitante_nome,
			tipo_direito: input.tipo_direito,
			descricao: input.descricao ?? null,
			status: 'pendente',
			prazo_resposta: calcularPrazoResposta()
		})
		.returning()
		.get();
}

export async function listarSolicitacoes(db: Database): Promise<LgpdSolicitacao[]> {
	return db.select().from(lgpdSolicitacoes).orderBy(desc(lgpdSolicitacoes.created_at)).all();
}

export async function listarSolicitacoesPorUsuario(
	db: Database,
	tipo: 'policial' | 'admin',
	id: number
): Promise<LgpdSolicitacao[]> {
	return db
		.select()
		.from(lgpdSolicitacoes)
		.where(
			and(eq(lgpdSolicitacoes.solicitante_tipo, tipo), eq(lgpdSolicitacoes.solicitante_id, id))
		)
		.orderBy(desc(lgpdSolicitacoes.created_at))
		.all();
}

export async function buscarSolicitacao(
	db: Database,
	id: number
): Promise<LgpdSolicitacao | undefined> {
	return db.select().from(lgpdSolicitacoes).where(eq(lgpdSolicitacoes.id, id)).get();
}

export async function responderSolicitacao(
	db: Database,
	id: number,
	status: StatusSolicitacao,
	resposta: string,
	respondidoPorNome: string
): Promise<LgpdSolicitacao | undefined> {
	const now = new Date().toISOString();
	return db
		.update(lgpdSolicitacoes)
		.set({
			status,
			resposta,
			respondido_por_nome: respondidoPorNome,
			respondido_em: now,
			updated_at: now
		})
		.where(eq(lgpdSolicitacoes.id, id))
		.returning()
		.get();
}
