/**
 * A decisão do Admin Geral sobre um pedido de AÇÃO DE RH — aprovar aqui não
 * fecha uma linha: movimenta, afasta ou inativa um servidor.
 *
 * Existe para que a rota `/solicitacoes` não precise saber como um ato de RH é
 * executado. Ela não sabe, e é esse o ponto: o efeito vem de `executarAcaoRH`, o
 * MESMO executor que a ficha usa no modo direto. Não há um segundo lugar onde o
 * efeito da movimentação seja montado, e portanto não há um segundo lugar de
 * onde ele possa divergir.
 *
 * O irmão deste fluxo — a decisão sobre um pedido de CAMPO — não precisou de
 * módulo: `decidirSolicitacaoCadastro` já fecha e aplica, gravando por
 * `atualizarPolicial` (que resolve cifra do CPF e normalização da matrícula).
 *
 * A ordem é: FECHAR o pedido primeiro, executar depois. Quem perde a corrida da
 * decisão recebe `null` e não executa nada; o inverso — executar e falhar ao
 * fechar — deixaria o servidor movimentado com o pedido ainda pendente, pronto
 * para ser movimentado de novo.
 */

import { fecharSolicitacaoAcao, type Database } from '$lib/db';
import type { PolicialAcaoSolicitacao } from '$lib/server/schema';
import { executarAcaoRH, type AtorDaAcao } from './acoes-rh';

/**
 * Decide um pedido de ação de RH. Aprovar EXECUTA o ato (movimentar, afastar,
 * desvincular) creditando a linha do tempo a quem pediu — ver `AtorDaAcao`.
 * Devolve a linha decidida, ou `null` quando ela já não estava pendente.
 */
export async function decidirSolicitacaoAcao(
	db: Database,
	solicitacaoId: number,
	aprovar: boolean,
	adminId: number
): Promise<PolicialAcaoSolicitacao | null> {
	const pedido = await fecharSolicitacaoAcao(db, solicitacaoId, aprovar, adminId);
	if (!pedido || !aprovar) return pedido;

	// `solicitante_*` é nulo apenas em linha adulterada à mão; cair no aprovador
	// mantém a linha do tempo com um responsável em vez de um vazio.
	const ator: AtorDaAcao = {
		id: pedido.solicitante_id ?? adminId,
		nome: pedido.solicitante_nome ?? 'Solicitante'
	};
	await executarAcaoRH(db, pedido.policial_id, pedido, ator);
	return pedido;
}
