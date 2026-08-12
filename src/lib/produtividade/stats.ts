/**
 * Cálculo de estatísticas agregadas a partir das respostas de produtividade.
 */

import { valorDaResposta } from './apresentacao';
import type { Question } from './questions';

interface StatsResult {
	prisaoFlagrante: number;
	prisaoMandado: number;
	prisoesTotal: number;
	[key: string]: unknown;
}

/**
 * Agrega estatísticas a partir dos dados filtrados.
 */
type FilteredDataItem = {
	respostasParsed?: Record<string, unknown>;
	respostas?: string;
	seccional_id?: number | null;
	/** `COALESCE(slot, unidade_operacional, seccional)` — ver `listarTodasRespostasGise`. */
	unidade_id?: number | null;
};

/**
 * Agrega os blobs de resposta nos totais do painel de produtividade.
 *
 * Percorre cada resposta uma única vez somando todas as perguntas: são centenas
 * de blobs por mês e a alternativa (uma passada por pergunta) multiplicaria o
 * custo pelo número de perguntas do modelo.
 *
 * Como se soma cada pergunta é decisão de `valorDaResposta`
 * (`$lib/produtividade/apresentacao`), e não daqui: a mesma regra — contar
 * ocorrências num `sim_nao`, normalizar peso de droga para gramas, respeitar o
 * gate booleano de armas — vale para as colunas, para o ranking e para este
 * total. Eram três cópias até ago/2026, e a de armas já divergia das outras
 * duas.
 *
 * Os totais de PRISÕES continuam explícitos aqui porque o bloco deles atravessa
 * três perguntas e não se reduz a nenhuma — ver `temBlocoPrisoes`.
 */
export function calculateStats(
	filteredData: FilteredDataItem[],
	questions: Question[]
): StatsResult {
	const s: StatsResult = {
		prisaoFlagrante: 0,
		prisaoMandado: 0,
		prisoesTotal: 0
	};

	// Initialize dynamic keys
	questions.forEach((q) => {
		if (typeof s[q.key] !== 'number') s[q.key] = 0;
	});

	filteredData.forEach((item) => {
		const res = (item.respostasParsed ?? JSON.parse(item.respostas || '{}')) as Record<
			string,
			unknown
		>;

		questions.forEach((q) => {
			s[q.key] = ((s[q.key] as number) || 0) + valorDaResposta(res, q);
		});

		// P4 & P5: Prisons
		if (res.procedimentos_flagrante_bool === 'Sim') {
			s.prisaoFlagrante += Number(res.prisoes_qtd) || 0;
		}
		s.prisaoMandado += Number(res.mandados_qtd) || 0;
		// P7, somado AQUI e não pelo laço das perguntas acima.
		//
		// O laço só passa pelas perguntas MARCADAS como gráfico, e o total de presos
		// é do bloco fixo de prisões — que existe mesmo quando ninguém marcou a P7
		// para virar barra. Deixá-lo depender da marca fazia o card "Total de
		// Presos" cair para zero assim que a pergunta saísse do painel: um número
		// errado, não um card ausente.
		s.prisoesTotal += Number(res.prisoes_apreensoes_flagrante) || 0;
	});

	return s;
}

interface RankingItem {
	nome: string;
	/** Nome encurtado para o rótulo; o completo fica em `nome`. */
	curto?: string;
	total: number;
}

/** Uma linha do ranking antes da soma — ver `gruposDaVisualizacao`. */
type GrupoItem = { id: number; nome: string; curto?: string };

/**
 * Ranking a partir de um extrator — quem chama decide O QUE está sendo contado
 * (`res => Number(res.mandados_cumpridos)`), esta função só soma.
 *
 * ## Os grupos vêm de fora, e a chave também
 *
 * Antes isto era fixo em seccional: recebia a lista de seccionais e somava por
 * `item.seccional_id`. O painel passou a comparar também DELEGACIAS, e a
 * alternativa a parametrizar era uma segunda função quase idêntica — a
 * duplicação catalogada no `CLAUDE.md`. Quem monta `grupos` e `chave` é
 * `$lib/produtividade/agrupamento`, o mesmo par usado pelos gráficos por
 * pergunta, para que as duas seções nunca discordem sobre quem entra na conta.
 *
 * TODO grupo recebido entra no mapa antes da soma, então unidade sem nenhuma
 * resposta aparece com total 0 em vez de desaparecer: no painel de
 * produtividade, "não produziu" é informação, não ausência de dado.
 *
 * NÃO ordena. A ordem é decisão da tela (melhores ou piores primeiro) e mora em
 * `ordenarERecortar` — ordenar aqui daria uma ordem que o chamador teria de
 * desfazer.
 */
export function calculateRanking(
	grupos: ReadonlyArray<GrupoItem>,
	filteredData: FilteredDataItem[],
	extractValue: (res: Record<string, unknown>) => number,
	chave: (item: FilteredDataItem) => number | null
): RankingItem[] {
	const r = new Map<number, RankingItem>();
	(grupos ?? []).forEach((g) => r.set(g.id, { nome: g.nome, curto: g.curto, total: 0 }));

	filteredData.forEach((item) => {
		const res = (item.respostasParsed ?? JSON.parse(item.respostas || '{}')) as Record<
			string,
			unknown
		>;
		const id = chave(item);
		const entry = id != null ? r.get(id) : undefined;
		if (entry) entry.total += extractValue(res);
	});
	return Array.from(r.values());
}
