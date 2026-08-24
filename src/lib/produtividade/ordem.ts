/**
 * A ORDEM dos cards no painel de produtividade — quem vem antes de quem, e como
 * uma pergunta nova entra sem empurrar ninguém.
 *
 * Até ago/2026 não havia ordem a escolher: cada seção desenhava os cards na
 * ordem em que as perguntas aparecem no modelo. Mover um gráfico exigia mover a
 * PERGUNTA no editor — o que renumera o enunciado ("4. HOUVE…") e reordena o
 * formulário que o policial preenche. Reordenar a leitura mexia na coleta, e por
 * isso a ordem do painel precisa ser um dado PRÓPRIO (`painel_ordem`, migração
 * 0064) em vez de um efeito colateral do formulário.
 *
 * ## A regra: o que não está na lista vai para o FIM
 *
 * A lista salva nomeia os cards que o Admin Geral arrastou. Card que não está
 * nela — a pergunta marcada depois da última organização — não some e não
 * aparece no topo: entra DEPOIS de todos os nomeados, na ordem natural (a do
 * formulário) entre os seus pares.
 *
 * É essa regra que responde ao pedido "pergunta nova aparece por último" sem
 * ninguém precisar reorganizar o painel a cada campo criado. A alternativa —
 * exigir que a lista salva cubra todo card existente — faria a marca de uma
 * pergunta nova depender de uma segunda tela para ter posição, e enquanto ela
 * não tivesse, a posição seria arbitrária.
 *
 * ## Id órfão é ignorado, não é card
 *
 * A lista guarda ids, não cards. Desmarcar a pergunta no editor tira o card do
 * painel e deixa o id aqui; ele não vira card fantasma porque a ordenação
 * PERCORRE os cards existentes e só consulta a lista para saber a posição de
 * cada um. Nada nunca é lido a partir da lista.
 *
 * ## "por último" é dentro da SEÇÃO
 *
 * Um card de colunas não cabe na grade dos rankings (é uma faixa inteira com
 * `<canvas>`), e um ranking não cabe na faixa das colunas. As seções são a FORMA
 * do card, não uma escolha — então a ordem é dentro de cada uma, e é uma lista
 * só para as três: cada seção pergunta a posição dos SEUS ids e ignora o resto.
 */

/**
 * O id de ordenação de um card, por forma.
 *
 * São os MESMOS ids que a seleção de exportação usa (`selectedCharts`), com uma
 * única conversão: o card de colunas se identifica pelo id numérico da pergunta,
 * e aqui ele vira string. Um vocabulário só para as duas coisas — dois seria a
 * duplicação que o `CLAUDE.md` cataloga, e a primeira divergência entre elas
 * apareceria como "arrastei o card e a exportação baixou outro".
 *
 * Os prefixos são o que impede colisão entre as formas da MESMA pergunta: sem
 * eles, o ranking e o detalhamento da pergunta 7 seriam o mesmo id.
 */
export const idCardColunas = (perguntaId: number): string => String(perguntaId);
/** Ranking por unidade de uma pergunta marcada. */
export const idCardRanking = (perguntaId: number): string => `rank-q${perguntaId}`;
/** Detalhamento por categoria de uma pergunta marcada. */
export const idCardDetalhe = (perguntaId: number): string => `det-q${perguntaId}`;
/**
 * Card de indicador de meta.
 *
 * Pela `key` do indicador, e não pelo id da pergunta, porque o indicador é
 * unificado entre os dois modelos por essa chave (`extrairIndicadoresDeModelos`)
 * — a mesma meta declarada nos dois formulários é UM indicador, e o id dele não
 * pode depender de qual das duas perguntas foi lida primeiro.
 */
export const idCardIndicador = (key: string): string => `ind-${key}`;

/**
 * A ordem salva, a partir do que está gravado em `painel_ordem`.
 *
 * Devolve lista vazia — que significa "ordem do formulário" — para `null`, para
 * JSON inválido e para JSON válido que não seja um array de strings. Tolerante
 * de propósito: o blob é escrito por uma versão do app e lido por outra, e um
 * painel que estoura porque a coluna trouxe `{}` seria pior do que um painel na
 * ordem antiga. Entradas não-string dentro do array são descartadas uma a uma.
 */
export function lerOrdemPainel(bruto: string | null | undefined): string[] {
	if (!bruto) return [];
	let valor: unknown;
	try {
		valor = JSON.parse(bruto);
	} catch {
		return [];
	}
	if (!Array.isArray(valor)) return [];
	return valor.filter((v): v is string => typeof v === 'string');
}

/**
 * Ordena os cards de UMA seção pela ordem salva.
 *
 * Duas fatias, nesta ordem: os cards NOMEADOS na lista, na posição que ela dá; e
 * os demais, na ordem em que chegaram (a do formulário). Ids da lista que não
 * correspondem a card nenhum são simplesmente pulados — ver o cabeçalho.
 *
 * Não muta `cards`: o painel passa por aqui a cada recálculo de `$derived`, e
 * ordenar no lugar reordenaria a lista de origem por baixo de quem a produziu.
 *
 * @param cards os cards da seção, na ordem natural do formulário
 * @param ordem a lista salva INTEIRA (as três seções juntas) — ids de fora desta
 *              seção não atrapalham, porque a busca é sempre a partir do card
 * @param idDoCard como extrair o id de ordenação de cada card
 */
export function ordenarCardsDoPainel<T>(
	cards: readonly T[],
	ordem: readonly string[],
	idDoCard: (card: T) => string
): T[] {
	if (ordem.length === 0) return [...cards];

	const posicao = new Map<string, number>();
	for (const [i, id] of ordem.entries()) {
		// `first wins`: um id repetido na lista (blob escrito à mão, merge de duas
		// gravações) valeria duas posições, e a segunda decidiria — o que faria o
		// card saltar para o fim sem nada explicando.
		if (!posicao.has(id)) posicao.set(id, i);
	}

	const nomeados: Array<{ card: T; pos: number }> = [];
	const novos: T[] = [];
	for (const card of cards) {
		const pos = posicao.get(idDoCard(card));
		if (pos === undefined) novos.push(card);
		else nomeados.push({ card, pos });
	}

	nomeados.sort((a, b) => a.pos - b.pos);
	return [...nomeados.map((n) => n.card), ...novos];
}

/**
 * Move um item de uma posição para outra, devolvendo a lista nova.
 *
 * Índice fora da lista devolve a lista intacta em vez de estourar: o alvo do
 * arraste vem de um evento do DOM, e um `dragend` fora de qualquer card chega
 * aqui como `-1`. Mesmo contrato de `moverPergunta` no editor do formulário.
 */
export function moverNaLista<T>(lista: readonly T[], de: number, para: number): T[] {
	const total = lista.length;
	if (de === para || de < 0 || para < 0 || de >= total || para >= total) return [...lista];
	const saida = [...lista];
	const [movido] = saida.splice(de, 1);
	saida.splice(para, 0, movido);
	return saida;
}
