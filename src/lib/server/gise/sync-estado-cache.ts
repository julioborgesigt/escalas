/**
 * Cache de edge do carimbo GLOBAL de GISE — a metade de `sync-estado.ts` que é
 * igual para todo mundo.
 *
 * `carimboGiseList` conta a tabela `gise_escalas` inteira e concatena o status
 * das ativas. Ele roda em todo `GET /api/sync/estado`, que é o poll de fundo de
 * cada aba aberta. Duas propriedades tornam isso caro de um jeito que piora
 * sozinho:
 *
 *  - o custo cresce com o HISTÓRICO (é agregado sem `WHERE`), então a conta
 *    aumenta a cada GISE encerrada, para sempre;
 *  - o resultado é IDÊNTICO para todos os usuários, então 200 policiais em
 *    campo produzem 200 varreduras iguais da mesma tabela a cada 30 s.
 *
 * A segunda é o que o cache resolve: dentro da janela, uma aba paga a query e
 * as outras 199 leem a resposta dela.
 *
 * ## Por que 15 s de atraso não muda nada
 *
 * O carimbo existe para o cliente decidir se vale reexecutar o `load` pesado, e
 * quem pergunta é um poll de 30 s (tela quente) ou 120 s (o resto) —
 * `useInvalidateOnFocus`. O mecanismo inteiro já é assíncrono por construção: a
 * tela nunca prometeu refletir uma mudança em menos de 30 s. Somar até 15 s a
 * uma janela de 30 s não introduz uma classe de atraso que não existisse.
 *
 * Por isso NÃO há invalidação explícita aqui, ao contrário de `papel-cache`:
 * não existe interação em que o usuário aja e espere ver o efeito neste
 * carimbo, porque nenhuma tela lê o carimbo — só o poll lê.
 *
 * ## O que deliberadamente NÃO entra
 *
 * `carimboResGise(db, policialId)` é POR USUÁRIO: cachear daria uma entrada por
 * policial, com taxa de acerto perto de zero (uma aba por pessoa), pagando
 * escrita de cache para nada. O custo dele era outro — varredura por falta de
 * índice — e foi resolvido na migração 0075.
 */

import { chaveEdge, memoEdge } from '../edge-cache';
import { carimboGiseList } from './sync-estado';
import type { Database } from '$lib/db';

/** Ver "Por que 15 s de atraso não muda nada" no cabeçalho. */
const TTL_SECONDS = 15;

const CHAVE = chaveEdge('carimbo-gise-list/v1');

/**
 * `carimboGiseList` com cache de edge, para uso do POLL.
 *
 * O sufixo `DoPoll` é contrato, não enfeite: este valor pode estar até
 * `TTL_SECONDS` atrasado. Se algum dia uma TELA precisar do carimbo para
 * decidir algo que o usuário vê no mesmo clique, ela chama `carimboGiseList`
 * direto — não este.
 */
export function carimboGiseListDoPoll(db: Database): Promise<string> {
	return memoEdge(CHAVE, TTL_SECONDS, () => carimboGiseList(db));
}
