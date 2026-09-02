/**
 * QUANTAS diárias uma missão gera, e em qual mês cada uma cai.
 *
 * Regra do Decreto Estadual nº 35.922/2024: sendo `N` o número de dias do
 * afastamento — `(data_fim − data_início) + 1` —, a missão com pernoite (`N > 1`)
 * gera `N − 0,5` diárias. Dois dias dão 1,5; sete dão 6,5; dez dão 9,5.
 *
 * ## Uma regra só, dois trabalhos
 *
 * O `N − 0,5` costuma ser escrito como fórmula fechada. Aqui ele é escrito como
 * **atribuição por dia**: cada dia do afastamento vale 2 meias, exceto o ÚLTIMO,
 * que vale 1. Somado, dá exatamente `2N − 1` meias — a mesma coisa.
 *
 * A diferença aparece no teto do art. 13 (15 diárias por mês, por servidor). Uma
 * missão de 28/set a 03/out lança **3 diárias em setembro e 2,5 em outubro**, e
 * é assim que a corporação conta: pela data de cada diária, não pelo mês em que
 * a missão começou. Com a fórmula fechada seria preciso uma SEGUNDA regra para
 * repartir o total entre os meses — e duas contas do mesmo número divergem, que
 * é a lição de duplicação do `CLAUDE.md`. Aqui `totalDeMeias` é a soma de
 * `meiasPorMes`, então não há como uma discordar da outra.
 *
 * ## A unidade é a MEIA diária, inteira
 *
 * Pelo mesmo motivo de `$lib/planos/meias-diarias`: `2.5` num campo `real`
 * colocaria float no caminho do dinheiro. Tudo aqui é inteiro; quem exibe
 * divide por dois.
 */
import { intervaloDeDatas, diffDiasInclusivo } from '$lib/utils/datas';

/**
 * Teto de dias de UMA missão, como guarda do laço.
 *
 * Não é regra da corporação — é a mesma proteção que `MAX_DIAS` faz em
 * `$lib/planos/horas-extras`: uma `data_fim` digitada como `2226-09-29`
 * prenderia o Worker percorrendo dia a dia. Trinta e um dias já excede o teto
 * mensal de 15 diárias, então nenhuma missão legítima esbarra nisto.
 */
const MAX_DIAS_AFASTAMENTO = 31;

/** Teto mensal por servidor, em meias diárias — 15 diárias (art. 13). */
export const MAX_MEIAS_MES = 30;

/**
 * `N` — os dias do afastamento, contando início e fim.
 *
 * `null` quando o período não é utilizável: formato inválido, fim antes do
 * início, ou intervalo maior que `MAX_DIAS_AFASTAMENTO`. `null` e não `0`
 * porque zero seria uma contagem, e não há missão de zero dias — quem chama
 * precisa poder dizer "este período não dá para analisar".
 */
export function diasDoAfastamento(dataInicio: string, dataFim: string): number | null {
	const n = diffDiasInclusivo(dataInicio, dataFim);
	if (n === 0 || n > MAX_DIAS_AFASTAMENTO) return null;
	return n;
}

/**
 * As meias diárias que a missão lança em CADA MÊS, com a chave `'YYYY-MM'`.
 *
 * Cada dia vale 2 meias; o último, 1. Devolve um mapa vazio quando o período
 * não é utilizável (ver `diasDoAfastamento`).
 */
export function meiasPorMes(dataInicio: string, dataFim: string): Map<string, number> {
	const out = new Map<string, number>();
	if (diasDoAfastamento(dataInicio, dataFim) === null) return out;

	const dias = intervaloDeDatas(dataInicio, dataFim);
	dias.forEach((dia, i) => {
		const meias = i === dias.length - 1 ? 1 : 2;
		const mes = dia.slice(0, 7);
		out.set(mes, (out.get(mes) ?? 0) + meias);
	});
	return out;
}

/**
 * O total de meias da missão — `2N − 1`, ou `0` se o período não for utilizável.
 *
 * Soma de `meiasPorMes` de propósito: é o que impede o total e o extrato mensal
 * de divergirem (ver o cabeçalho).
 */
export function totalDeMeias(dataInicio: string, dataFim: string): number {
	let soma = 0;
	for (const meias of meiasPorMes(dataInicio, dataFim).values()) soma += meias;
	return soma;
}

/**
 * Os meses em que a missão estouraria o teto do art. 13, dado o que o servidor
 * JÁ tem lançado em cada mês.
 *
 * `jaLancado` vem do banco (ver `$lib/db/planos/diarias-mensais`). Devolve as
 * chaves `'YYYY-MM'` em ordem — vazio quando nenhum mês estoura.
 */
export function mesesAcimaDoTeto(
	dataInicio: string,
	dataFim: string,
	jaLancado: Map<string, number>
): string[] {
	const estouram: string[] = [];
	for (const [mes, meias] of meiasPorMes(dataInicio, dataFim)) {
		if ((jaLancado.get(mes) ?? 0) + meias > MAX_MEIAS_MES) estouram.push(mes);
	}
	return estouram.sort();
}
