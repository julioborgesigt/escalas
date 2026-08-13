/**
 * Pedidos de titular de dados (LGPD, art. 18).
 *
 * O titular abre a solicitação por `/termo/dpo` e o encarregado responde no
 * painel; o registro é a prova de atendimento no prazo legal, por isso nada
 * aqui é apagado — só muda de status.
 */
import { desc, eq, and } from 'drizzle-orm';
import { lgpdSolicitacoes } from '../../server/schema';
import type { Database } from '../core';
import type { LgpdSolicitacao } from '../../server/schema';
import { adicionarDias } from '../../utils/datas';

/** Direitos do art. 18 da LGPD que o formulário oferece. */
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

/**
 * Prazo: 15 dias úteis ≈ 21 dias corridos (art. 18, §5º, LGPD).
 *
 * Via `adicionarDias`, que faz a conta inteira em UTC. A versão anterior
 * misturava as duas convenções na mesma função — `setDate` (local) para somar e
 * `toISOString` (UTC) para sair —, que é exatamente a forma dos bugs de data já
 * corrigidos neste projeto. Não errava porque o Worker roda em UTC; erraria em
 * qualquer runtime com fuso.
 */
function calcularPrazoResposta(): string {
	return adicionarDias(new Date().toISOString().slice(0, 10), 21);
}

/**
 * Abre a solicitação do titular e devolve a linha criada, já com `status`
 * `pendente` e o `prazo_resposta` calculado — o prazo legal não é escolhido pelo
 * chamador justamente para que nenhum caminho consiga gravar um vencimento fora
 * do art. 18, §5º.
 */
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

/**
 * TODAS as solicitações, mais recentes primeiro — visão do encarregado. Sem
 * paginação: o volume é de dezenas por ano. Para a visão do titular use
 * `listarSolicitacoesPorUsuario`, que é escopada.
 */
export async function listarSolicitacoes(db: Database): Promise<LgpdSolicitacao[]> {
	return db.select().from(lgpdSolicitacoes).orderBy(desc(lgpdSolicitacoes.created_at)).all();
}

/** Usada na tela do próprio titular ("minhas solicitações"). */
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

/**
 * Uma solicitação por id, SEM checar de quem é. Quem expõe ao titular precisa
 * comparar `solicitante_tipo`/`solicitante_id` com o usuário da sessão — caso
 * contrário o id na URL vira IDOR sobre pedido de dado pessoal de terceiro.
 */
export async function buscarSolicitacao(
	db: Database,
	id: number
): Promise<LgpdSolicitacao | undefined> {
	return db.select().from(lgpdSolicitacoes).where(eq(lgpdSolicitacoes.id, id)).get();
}

/**
 * Resposta do encarregado. Guarda o NOME de quem respondeu (e não só o id):
 * o registro precisa continuar legível mesmo que a conta seja desativada
 * depois.
 */
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
