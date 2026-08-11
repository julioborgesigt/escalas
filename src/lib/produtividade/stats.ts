/**
 * Cálculo de estatísticas agregadas a partir das respostas de produtividade.
 */

import type { Question } from './questions';

interface StatsResult {
	drogasGeral: number;
	drogasPorTipo: Record<string, number>;
	apreensoes_armas: number;
	armasPorTipo: Record<string, number>;
	prisaoFlagrante: number;
	prisaoMandado: number;
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
 * Duas formas de agregar, decididas pelo tipo da pergunta: `isBool` CONTA
 * ocorrências (cada `'Sim'` vale 1 evento) e o resto SOMA o valor numérico —
 * tratar um "sim" como número daria zero e a pergunta desapareceria do painel.
 * A leitura usa `mappedKey`, não `key`, porque nos tipos compostos a resposta
 * mora em outra chave do blob.
 *
 * Drogas: os pesos são normalizados para GRAMAS (`kg` × 1000) antes de somar,
 * senão 2 kg e 2 g virariam o mesmo 2 no total.
 *
 * Armas: o detalhe por tipo só é contado quando a pergunta booleana (`armasKey`,
 * que vem do modelo porque o assessor pode ter renomeado) está `'Sim'` — mesma
 * regra do relatório, para que lista digitada e depois negada não conte.
 */
export function calculateStats(
	filteredData: FilteredDataItem[],
	questions: Question[],
	armasKey: string
): StatsResult {
	const s: StatsResult = {
		drogasGeral: 0,
		drogasPorTipo: {},
		apreensoes_armas: 0,
		armasPorTipo: {},
		prisaoFlagrante: 0,
		prisaoMandado: 0
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

		// Dynamic Aggregation for all Numeric/Boolean/Smart Questions
		questions.forEach((q) => {
			const val = res[q.mappedKey || q.key];
			if (q.isBool) {
				if (val === 'Sim') s[q.key] = ((s[q.key] as number) || 0) + 1;
			} else {
				s[q.key] = ((s[q.key] as number) || 0) + (Number(val) || 0);
			}
		});

		// P10: Drugs
		if (res.drogas_detalhe) {
			Object.entries(res.drogas_detalhe as Record<string, unknown>).forEach(([tipo, peso]) => {
				const drogas_unidade = res.drogas_unidade as Record<string, unknown> | undefined;
				const unid = (drogas_unidade && drogas_unidade[tipo]) || 'g';
				let pNorm = Number(peso) || 0;
				if (unid === 'kg') pNorm *= 1000;
				s.drogasPorTipo[tipo] = (s.drogasPorTipo[tipo] || 0) + pNorm;
				s.drogasGeral += pNorm;
			});
		}

		// P11: Weapons
		if (res[armasKey] === 'Sim' && res.armas_detalhe) {
			Object.entries(res.armas_detalhe as Record<string, unknown>).forEach(([tipo, qtd]) => {
				const n = Number(qtd) || 0;
				s.apreensoes_armas += n;
				s.armasPorTipo[tipo] = (s.armasPorTipo[tipo] || 0) + n;
			});
		}

		// P4 & P5: Prisons
		if (res.procedimentos_flagrante_bool === 'Sim') {
			s.prisaoFlagrante += Number(res.prisoes_qtd) || 0;
		}
		s.prisaoMandado += Number(res.mandados_qtd) || 0;
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
