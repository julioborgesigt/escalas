/**
 * Como cada pergunta é LIDA e como cada card dela é APRESENTADO.
 *
 * Existe porque as três formas do painel (colunas, ranking, detalhamento) fazem
 * a mesma pergunta ao blob de respostas — "quanto vale isto aqui?" — e a resposta
 * dependia do tipo em três lugares diferentes: `valorDaResposta` no motor dos
 * gráficos, os extratores dos rankings em `useProdutividade` e a agregação de
 * `calculateStats`. Três cópias da regra "peso de droga em kg vira grama", e a
 * armadilha catalogada no `CLAUDE.md`: consertar uma e esquecer as outras.
 *
 * ## Por que a regra é por TIPO e não por chave
 *
 * A `key` da pergunta é editável no clone de um formulário; o tipo é o que
 * decide onde o formulário GRAVA. `RelatorioProdutividade` escreve
 * `drogas_detalhe` para toda pergunta `drogas_complex`, seja qual for a `key`.
 * A versão anterior disto olhava `q.key === 'apreensoes_drogas'` e teria parado
 * de somar peso na primeira operação que renomeasse a pergunta.
 *
 * ## Unidade de medida não é enfeite
 *
 * Peso de droga é somado em GRAMAS e mostrado em quilos. Um ranking genérico que
 * ignorasse isso mostraria "2450" onde deveria estar "2,4 kg" — e o número
 * estaria certo, só que na unidade errada, que é a forma mais silenciosa de
 * errar. Por isso a unidade vem daqui e não do call site.
 */
import { exigeSimParaContar } from '$lib/gise/tipos-pergunta';
import type { GraficoConfig } from '$lib/types';

/** As três formas que uma pergunta pode assumir no painel. */
export type FormaGrafico = 'colunas' | 'ranking' | 'detalhe';

/** O mínimo de uma pergunta para as funções deste módulo. */
interface PerguntaLegivel {
	key: string;
	mappedKey: string;
	tipo: string;
}

/**
 * Aparência dos tipos que o painel sempre desenhou com identidade própria.
 *
 * Drogas e armas tinham cards escritos no código (`VIRTUAL_CHARTS`), com título,
 * cor e unidade fixos. Ao virarem perguntas marcadas, essa identidade tinha de ir
 * junto — senão "Ranking de Drogas" viraria "10. HOUVE APREENSÃO DE DROGAS?" em
 * caixa alta, e o peso apareceria em gramas.
 *
 * Quem não está aqui usa o texto da pergunta e a cor da paleta, que é o certo:
 * uma pergunta nova não tem identidade a preservar.
 *
 * É PADRÃO, não regra: o título daqui cede ao `rotulo_painel` que o admin
 * escrever (ver `tituloNoPainel`). A cor e a unidade não cedem — a unidade
 * porque `'g'` diz onde o número foi somado, e trocá-la por digitação faria o
 * card mostrar gramas chamando-as de outra coisa.
 */
const IDENTIDADE_POR_TIPO: Record<string, { titulo: string; cor: string; unidade: string }> = {
	drogas_complex: { titulo: 'Drogas', cor: '#ef4444', unidade: 'g' },
	armas_complex: { titulo: 'Armas', cor: '#6366f1', unidade: '' }
};

/** O mínimo de uma pergunta para se descobrir o título do card dela. */
export interface PerguntaIntitulavel {
	tipo: string;
	texto: string;
	/** O que o admin escreveu no editor; vazio ou ausente cai nos padrões. */
	rotulo_painel?: string;
}

/**
 * O título do card desta pergunta no painel, em três degraus.
 *
 * 1. o **rótulo próprio**, se o admin escreveu um. Escolha explícita ganha de
 *    qualquer padrão — inclusive da identidade fixa de drogas e armas, que é
 *    padrão de fábrica e não decisão de quem montou a operação;
 * 2. a **identidade do tipo** (`Drogas`, `Armas`), que os cards escritos no
 *    código já usavam antes de virarem pergunta marcada;
 * 3. o **texto da pergunta**, que é o que sempre houve.
 *
 * Uma função só, e não a regra repetida nos dois lados, porque as duas seções do
 * painel a fazem: os cards de gráfico/ranking/detalhamento (via
 * `identidadeDaPergunta`) e os de indicador de meta. Escrever a precedência duas
 * vezes é o começo de "o gráfico respeita o rótulo e o indicador não".
 *
 * O `trim()` não é detalhe: um campo de texto devolve `' '` com a mesma
 * facilidade com que devolve `''`, e um título de um espaço em branco deixaria o
 * card sem cabeçalho nenhum, sem erro em lugar algum.
 */
export function tituloNoPainel(p: PerguntaIntitulavel): string {
	return p.rotulo_painel?.trim() || IDENTIDADE_POR_TIPO[p.tipo]?.titulo || p.texto;
}

/** Título e cor do card desta pergunta, preservando a identidade de drogas e armas. */
export function identidadeDaPergunta(
	p: PerguntaIntitulavel,
	corDaPaleta: string
): { titulo: string; cor: string; unidade: string } {
	const identidade = IDENTIDADE_POR_TIPO[p.tipo];
	return {
		titulo: tituloNoPainel(p),
		cor: identidade?.cor ?? corDaPaleta,
		unidade: identidade?.unidade ?? ''
	};
}

/**
 * O valor de UMA resposta para UMA pergunta — a conta das colunas e do ranking.
 *
 * Quatro formas, decididas pelo tipo:
 *
 * - `sim_nao` CONTA ocorrências (cada `'Sim'` vale 1). Somar o texto daria zero e
 *   a pergunta sumiria do painel;
 * - `drogas_complex` soma o PESO normalizado em gramas (`kg` × 1000 — senão 2 kg
 *   e 2 g virariam o mesmo 2);
 * - `armas_complex` soma as quantidades por tipo;
 * - o resto soma o número em `mappedKey`, que nos tipos de lista é a chave de
 *   QUANTIDADE (`prisoes_qtd`, `${key}__qtd`) e não a `key` da pergunta.
 *
 * ## O gate do "Sim"
 *
 * Nos tipos que perguntam "houve X? → se sim, quantos", a quantidade só conta com
 * a resposta em `'Sim'` (`exigeSimParaContar`). O blob GUARDA o que foi digitado:
 * quem preenche a listagem, muda de ideia e responde "Não" deixa o número lá. O
 * relatório assinado já ignorava esse resto — ele só expande a lista sob um
 * "Sim" —, e o painel não ignorava. As duas leituras do mesmo dado discordavam,
 * e a do painel contava produção que o PDF não mostra.
 */
export function valorDaResposta(res: Record<string, unknown>, q: PerguntaLegivel): number {
	if (q.tipo === 'sim_nao') return res[q.key] === 'Sim' ? 1 : 0;
	if (exigeSimParaContar(q.tipo) && res[q.key] !== 'Sim') return 0;
	if (q.tipo === 'drogas_complex' || q.tipo === 'armas_complex') {
		return somarDetalhe(detalheDaResposta(res, q));
	}
	return Number(res[q.mappedKey || q.key]) || 0;
}

/**
 * A quebra por categoria de UMA resposta — `{ 'REVOLVER': 2, 'PISTOLA': 1 }`.
 *
 * Objeto vazio quando a pergunta não tem quebra ou quando a resposta não a
 * preencheu. Em armas o gate booleano vale aqui também: `armas_detalhe` pode
 * estar preenchido com a pergunta respondida "Não", e nesse caso o certo é não
 * contar nada.
 */
function detalheDaResposta(
	res: Record<string, unknown>,
	q: PerguntaLegivel
): Record<string, number> {
	if (q.tipo === 'drogas_complex') {
		const bruto = res.drogas_detalhe;
		if (!bruto || typeof bruto !== 'object') return {};
		const unidades = res.drogas_unidade as Record<string, string> | undefined;
		const saida: Record<string, number> = {};
		for (const [tipo, peso] of Object.entries(bruto as Record<string, unknown>)) {
			let valor = Number(peso) || 0;
			if ((unidades?.[tipo] ?? 'g') === 'kg') valor *= 1000;
			saida[tipo] = valor;
		}
		return saida;
	}

	if (q.tipo === 'armas_complex') {
		// O gate do "Sim" também aqui: `valorDaResposta` já o aplica antes de
		// chamar, mas o card de detalhamento entra por `detalhePorTipo`, que não
		// passa por lá.
		if (res[q.key] !== 'Sim') return {};
		const bruto = res.armas_detalhe;
		if (!bruto || typeof bruto !== 'object') return {};
		const saida: Record<string, number> = {};
		for (const [tipo, qtd] of Object.entries(bruto as Record<string, unknown>)) {
			saida[tipo] = Number(qtd) || 0;
		}
		return saida;
	}

	return {};
}

/** Soma os valores de uma quebra por categoria. */
function somarDetalhe(detalhe: Record<string, number>): number {
	let total = 0;
	for (const v of Object.values(detalhe)) total += v;
	return total;
}

/**
 * A quebra por categoria de TODAS as respostas do período, já ordenada do maior
 * para o menor e cortada nas oito primeiras.
 *
 * Oito porque o card é uma coluna de barras horizontais e a nona não cabe sem
 * rolagem; a ordem decrescente é o que põe a categoria dominante no topo, que é
 * a leitura que o card existe para dar. O corte é da APRESENTAÇÃO — o total do
 * card continua sendo o de tudo.
 */
export function detalhePorTipo(
	respostas: Array<{ respostasParsed?: Record<string, unknown>; respostas?: string }>,
	q: PerguntaLegivel,
	limite = 8
): { linhas: [string, number][]; total: number } {
	const acumulado: Record<string, number> = {};
	let total = 0;

	for (const item of respostas) {
		const res = (item.respostasParsed ?? JSON.parse(item.respostas || '{}')) as Record<
			string,
			unknown
		>;
		for (const [tipo, valor] of Object.entries(detalheDaResposta(res, q))) {
			acumulado[tipo] = (acumulado[tipo] ?? 0) + valor;
			total += valor;
		}
	}

	const linhas = (Object.entries(acumulado) as [string, number][])
		.sort((a, b) => b[1] - a[1])
		.slice(0, limite);

	return { linhas, total };
}

/**
 * As três formas de uma marca, aceitando também a forma ANTIGA da marca.
 *
 * Entre a migração 0053 e a 0054, `grafico` era um booleano que queria dizer
 * "colunas". A 0054 converteu os que estavam no nível 0 do modelo — `json_each`
 * anda na raiz do array e não desce —, mas a caixinha do editor sempre esteve
 * disponível em qualquer nível, então uma SUB-pergunta marcada nessa janela
 * ficou com o booleano.
 *
 * Recursão em SQL para uma árvore de profundidade livre custaria mais do que
 * vale; a compatibilidade mora aqui, é uma linha, e vale para qualquer nível. O
 * booleano some do banco na primeira vez que alguém mexer naquela caixinha.
 *
 * Sem isto, `!!true.colunas` daria `false` e a sub-pergunta marcada sairia do
 * painel sem nada explicando — que é exatamente o tipo de perda silenciosa que
 * uma virada de formato precisa não ter.
 */
export function formasDaMarca(
	grafico: GraficoConfig | boolean | undefined
): Required<GraficoConfig> {
	if (grafico === true) return { colunas: true, ranking: false, detalhe: false };
	if (!grafico || typeof grafico !== 'object') {
		return { colunas: false, ranking: false, detalhe: false };
	}
	return {
		colunas: !!grafico.colunas,
		ranking: !!grafico.ranking,
		detalhe: !!grafico.detalhe
	};
}

/** A pergunta gera algum card? Marca ausente, vazia ou toda desligada não gera. */
export function temAlgumaForma(g: GraficoConfig | boolean | undefined): boolean {
	const f = formasDaMarca(g);
	return f.colunas || f.ranking || f.detalhe;
}
