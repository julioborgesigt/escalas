/**
 * Cache de edge dos carimbos GLOBAIS de escalas — a metade de `sync-estado.ts`
 * que é igual para todo mundo.
 *
 * `carimboPainel` agrega a tabela `escalas` inteira; `resumoRecebidosAdmin`
 * junta `escalas ⋈ escala_documentos` inteiras. Nenhum dos dois tem `WHERE`, e
 * os dois rodam em todo `GET /api/sync/estado` — o poll de fundo de cada aba
 * aberta. O custo cresce com o arquivo (agregado sem recorte) e é pago em
 * duplicata por cada admin com uma aba aberta, para chegar ao mesmo número.
 *
 * O raciocínio de TTL e a ausência de invalidação explícita são os mesmos de
 * `gise/sync-estado-cache.ts` — o poll já tolera 30 s a 120 s por construção.
 *
 * ## `resumoRecebidosAdmin` tem DOIS consumidores, e só um pode usar o cache
 *
 * A função devolve `{ naoVistos, stamp }`, e o `naoVistos` alimenta duas
 * coisas diferentes:
 *
 *  - o **poll**, que só quer saber se algo mudou desde o último tique;
 *  - o **badge da barra lateral**, montado no `+layout.server.ts` e revalidado
 *    por `invalidate('app:recebidos-badge')` logo depois que o admin marca uma
 *    escala como vista.
 *
 * O segundo é uma reação DIRETA a um clique: o usuário age e espera o número
 * baixar. Servir cache ali quebraria justamente a invalidação explícita que
 * alguém escreveu para isso funcionar — o badge ficaria parado por até
 * `TTL_SECONDS` depois do clique, sem nada acusando. Por isso o cache mora aqui
 * e não dentro de `resumoRecebidosAdmin`: quem quer o valor vivo continua
 * chamando a função original, e a diferença está no nome do que se importa.
 */

import { chaveEdge, memoEdge } from '../edge-cache';
import { carimboPainel, resumoRecebidosAdmin } from './sync-estado';
import type { Database } from '$lib/db';

/** Ver `gise/sync-estado-cache.ts` para o porquê de 15 s. */
const TTL_SECONDS = 15;

const CHAVE_PAINEL = chaveEdge('carimbo-painel/v1');
const CHAVE_RECEBIDOS = chaveEdge('resumo-recebidos/v1');

/**
 * `carimboPainel` com cache de edge, para uso do POLL.
 *
 * O sufixo `DoPoll` é contrato: este valor pode estar até `TTL_SECONDS`
 * atrasado.
 */
export function carimboPainelDoPoll(db: Database): Promise<string> {
	return memoEdge(CHAVE_PAINEL, TTL_SECONDS, () => carimboPainel(db));
}

/**
 * `resumoRecebidosAdmin` com cache de edge, **exclusivo do POLL**.
 *
 * NÃO use no `+layout.server.ts`: o badge da barra lateral é revalidado por
 * `invalidate('app:recebidos-badge')` na sequência de um clique do admin e
 * precisa do número vivo. Ver o cabeçalho deste módulo.
 *
 * O `naoVistos` que sai daqui pode estar atrasado, e hoje ninguém o exibe: o
 * cliente lê só `e.recebidos?.stamp` (`+layout.svelte`, `recebidos/+page.svelte`)
 * e, quando ele muda, manda o `load` do layout buscar o número de verdade. Quem
 * for RENDERIZAR o `naoVistos` desta resposta troca essa cadeia por um valor de
 * cache — e aí o campo precisa vir de `resumoRecebidosAdmin`, não daqui.
 */
export function resumoRecebidosDoPoll(db: Database): Promise<{ naoVistos: number; stamp: string }> {
	return memoEdge(CHAVE_RECEBIDOS, TTL_SECONDS, () => resumoRecebidosAdmin(db));
}
