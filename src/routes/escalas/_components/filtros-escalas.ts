/**
 * As REGRAS da tela de escalas — o que é decisão, e não estado de tela.
 *
 * Saiu de `escalas/+page.svelte` porque o `CLAUDE.md` diz onde regra que precisa
 * de teste tem de morar: **fora do `.svelte`**. O vitest roda sem DOM, então
 * componente só é exercitado por Playwright — caro, lento, e que só alcança o
 * que a interface deixa alcançar. Aquele arquivo tinha 433 linhas de lógica e
 * 90 ramos, o mais opaco do repositório pela régua do próprio projeto
 * (`npm run docs:inventario`), e nenhuma destas regras tinha teste.
 *
 * O que ficou lá: estado reativo, efeitos, diálogos, chamadas de API. O que veio
 * para cá: as perguntas que se respondem com entrada e saída.
 *
 * **A extração já pagou por si.** Os padrões dos filtros estavam escritos em
 * TRÊS lugares — o objeto de `getSavedFilters`, o `limparFiltros` e o
 * `temFiltros` — e um deles discordava: o primeiro usava `lotacao: ''` e os
 * outros dois, `'todas'`. Para quem entrava pela primeira vez (localStorage
 * vazio, sem query), `filtroLotacao` nascia `''`, o `temFiltros` fazia
 * `'' !== 'todas'` e o botão "limpar filtros" aparecia ATIVO numa tela sem
 * filtro nenhum. Enquanto eram três cópias não havia o que comparar; com uma
 * fonte só, a divergência deixou de caber.
 */

import type { Unidade } from '$lib/types';

/** Escala pode estar "aguardando assinatura", "arquivada", ou em nenhuma pasta. */
export type StatusEscala = 'aguardando' | 'arquivada' | '';

/**
 * O conjunto de filtros da tela, do jeito que ele viaja para a query.
 *
 * `type` e não `interface` de propósito: `getSavedFilters` pede
 * `T extends Record<string, unknown>`, e interface não ganha assinatura de
 * índice implícita — com `interface` a inferência falha e todo campo vira
 * `unknown` no call site.
 */
export type FiltrosEscalas = {
	lotacao: string;
	mes: number;
	ano: number;
	tipo: string;
	seccional: number | 'todas';
	busca: string;
	status: StatusEscala;
};

/**
 * O valor de "nenhum filtro de lotação" — e são DOIS, de propósito.
 *
 * O `<select>` tem a opção vazia ("Selecione uma unidade...") e a explícita
 * ("Todas as unidades"). As duas significam a mesma coisa para a consulta, e
 * `queryDeFiltros` já tratava as duas igual; era só o `temFiltros` que
 * distinguia, e distinguir ali era o bug. Normalizar para um valor só mudaria o
 * que a tela mostra; reconhecer os dois não muda nada e diz a verdade.
 */
function semLotacao(v: string): boolean {
	return v === '' || v === 'todas';
}

/**
 * Os padrões da tela — a ÚNICA fonte deles.
 *
 * `hoje` é parâmetro para o teste não depender do relógio: mês e ano padrão são
 * os correntes, e um teste que os calculasse de novo passaria por tautologia.
 */
export function filtrosPadrao(hoje: Date = new Date()): FiltrosEscalas {
	return {
		lotacao: 'todas',
		mes: hoje.getMonth() + 1,
		ano: hoje.getFullYear(),
		tipo: 'todos',
		seccional: 'todas',
		busca: '',
		status: ''
	};
}

/**
 * Algum filtro saiu do padrão? É o que decide mostrar o botão "limpar filtros".
 *
 * **`busca` e `status` ficam de fora, e isso é decisão.** A busca tem handler
 * próprio (com debounce) e some sozinha ao ser apagada; o `status` não é filtro,
 * é a PASTA em que se está (aguardando / arquivo) — o `limparFiltros` também o
 * preserva, e um botão que trocasse de pasta ao "limpar" tiraria o usuário de
 * onde ele estava.
 */
export function temFiltrosAtivos(f: FiltrosEscalas, padrao: FiltrosEscalas): boolean {
	return (
		f.seccional !== padrao.seccional ||
		!semLotacao(f.lotacao) ||
		f.mes !== padrao.mes ||
		f.ano !== padrao.ano ||
		f.tipo !== padrao.tipo
	);
}

/**
 * Os filtros como query string do servidor.
 *
 * Os sentinelas NÃO viajam: `'todas'`/`'todos'` e o zero de mês/ano significam
 * "sem filtro", e mandá-los faria o servidor filtrar por um valor literal que
 * não existe em coluna nenhuma. `status` só viaja nos dois valores que a rota
 * entende — qualquer outro é ausência de pasta, não uma terceira pasta.
 */
export function queryDeFiltros(f: FiltrosEscalas, pagina: number): URLSearchParams {
	const params = new URLSearchParams();
	if (!semLotacao(f.lotacao)) params.set('lotacao', f.lotacao);
	if (f.mes) params.set('mes', String(f.mes));
	if (f.ano) params.set('ano', String(f.ano));
	if (f.tipo && f.tipo !== 'todos') params.set('tipo', f.tipo);
	if (f.busca) params.set('busca', f.busca);
	if (f.status === 'aguardando' || f.status === 'arquivada') params.set('status', f.status);
	params.set('page', String(pagina));
	return params;
}

/**
 * As delegacias que o dropdown mostra: todas, ou só as da seccional escolhida.
 *
 * `seccional` filtra o dropdown no CLIENTE e não vai para a query — é recorte
 * de navegação, não de consulta.
 */
export function delegaciasVisiveis(
	unidades: readonly Unidade[],
	seccional: number | 'todas'
): Unidade[] {
	return unidades.filter(
		(u) => u.tipo === 'delegacia' && (seccional === 'todas' || u.seccional_id === seccional)
	);
}

/** Para onde o clique de "editar" leva. */
export type DestinoDaEdicao = 'revogar' | 'solicitacao' | 'abrir';

/**
 * O clique de editar tem TRÊS destinos, e a ordem entre eles é a regra.
 *
 * Escala assinada não se edita: primeiro revoga (o diálogo explica que a
 * assinatura cai). Só depois disso a solicitação pendente do OIP importa — se a
 * ordem invertesse, quem tem solicitação numa escala JÁ ASSINADA cairia no
 * diálogo de solicitação e editaria por baixo de uma assinatura válida.
 */
export function destinoDaEdicao(
	escala: { is_assinada?: boolean | null; id: number },
	opts: { podeOIPSolicitar: boolean; temSolicitacao: boolean }
): DestinoDaEdicao {
	if (escala.is_assinada) return 'revogar';
	if (opts.podeOIPSolicitar && opts.temSolicitacao) return 'solicitacao';
	return 'abrir';
}

/**
 * O título da lista, que anuncia a PASTA aberta.
 *
 * Sem status não é "nenhuma pasta": a tela cai no arquivo, que é o destino de
 * quem chegou por link sem `?status=`.
 */
export function tituloDaLista(status: StatusEscala): string {
	if (status === 'arquivada') return 'Escalas criadas (arquivo)';
	if (status === 'aguardando') return 'Escalas aguardando ass';
	return 'Arquivo';
}

/**
 * Os anos oferecidos no filtro: `0` ("Todos") e a janela de cinco anos que
 * começa no ANTERIOR ao corrente.
 *
 * Começa no anterior porque escala do ano passado ainda é consultada (arquivo,
 * auditoria), e terminar no corrente impediria criar a do ano que vem em
 * dezembro.
 */
export function anosDisponiveis(hoje: Date = new Date()): number[] {
	return [0, ...Array.from({ length: 5 }, (_, i) => hoje.getFullYear() - 1 + i)];
}
