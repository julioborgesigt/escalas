/**
 * Quais perguntas do formulário viram GRÁFICO de barras no painel, e onde ler a
 * resposta de cada uma.
 *
 * ## A marca manda, não o tipo
 *
 * Até ago/2026 esta era a regra inteira: `tipo` em `CHARTABLE_TYPES` → vira
 * gráfico. Ninguém escolhia nada. O resultado é que a quilometragem inicial e a
 * final da viatura — perguntas de tipo `numero`, como as prisões — ocupavam dois
 * cards do painel, e não havia jeito de tirá-las a não ser apagando o campo do
 * formulário, o que também apagaria a coleta.
 *
 * Agora quem decide é `pergunta.grafico`, marcada no editor. O tipo continua
 * valendo, mas só como VETO: uma pergunta marcada cujo tipo deixou de ser
 * graficável (o admin trocou `numero` por `textarea` depois) é descartada aqui,
 * senão o painel tentaria somar prosa.
 *
 * ## `key` × `mappedKey`
 *
 * `key` identifica a PERGUNTA; a RESPOSTA nem sempre mora nela. Nos tipos
 * compostos o número está numa chave fixa do blob (`celulares_qtd`), e é
 * `mappedKey` que faz a tradução. Confundir as duas dá gráfico zerado sem erro
 * nenhum — o painel soma `undefined` e mostra barra vazia.
 */

import { podeSerGrafico } from '$lib/gise/tipos-pergunta';
import type { GiseModeloPerguntaConfig } from '$lib/types';

const palette = [
	'#3b82f6',
	'#10b981',
	'#f59e0b',
	'#f43f5e',
	'#06b6d4',
	'#8b5cf6',
	'#ef4444',
	'#6366f1',
	'#14b8a6',
	'#d946ef',
	'#f97316',
	'#ec4899',
	'#64748b',
	'#94a3b8',
	'#a855f7'
];

const KEY_MAP: Record<string, string> = {
	celulares_complex: 'celulares_qtd',
	analise_complex: 'analise_qtd',
	relatorios_seint_complex: 'relatorios_seint_qtd',
	foragidos_complex: 'foragidos_qtd',
	operacoes_seint_complex: 'operacoes_seint_qtd',
	operacoes_seint_pura: 'operacoes_seint_qtd'
};

export interface Question {
	id: number;
	label: string;
	key: string;
	mappedKey: string;
	color: string;
	isBool: boolean;
	specialStore: string | null;
}

type ModeloQuestion = Pick<GiseModeloPerguntaConfig, 'id' | 'texto' | 'key' | 'tipo'> & {
	grafico?: boolean;
	filhos?: ModeloQuestion[];
};

/**
 * Converte o modelo cru nas perguntas que vão ao painel, na ordem do formulário.
 *
 * Duas condições, as duas necessárias: a pergunta está MARCADA como gráfico e o
 * tipo dela ainda comporta um (ver o cabeçalho). Cada uma recebe `mappedKey` e
 * uma cor fixa pela posição — a mesma pergunta mantém a mesma cor entre os
 * gráficos.
 *
 * Desce nos `filhos`: sub-pergunta é pergunta, com `key` própria e resposta
 * própria, e já podia ser indicador (`extrairIndicadores` sempre desceu). Não
 * descer aqui deixaria a caixinha do editor sem efeito no nível 1 — a armadilha
 * que o `CLAUDE.md` cataloga.
 *
 * Recebe o modelo já escolhido pelo chamador (operacional ou SEINT); não decide
 * qual usar.
 */
export function mapQuestions(modelo: ModeloQuestion[] | undefined | null): Question[] {
	if (!modelo || modelo.length === 0) return [];

	const marcadas: ModeloQuestion[] = [];
	function andar(lista: ModeloQuestion[]) {
		for (const q of lista) {
			if (q.grafico && podeSerGrafico(q.tipo)) marcadas.push(q);
			if (q.filhos?.length) andar(q.filhos);
		}
	}
	andar(modelo);

	return marcadas.map((q, idx: number) => {
		const mappedKey = KEY_MAP[q.tipo] ?? q.key;
		return {
			id: q.id,
			label: q.texto,
			key: q.key,
			mappedKey,
			color: palette[idx % palette.length],
			isBool: q.tipo === 'sim_nao',
			specialStore: q.key === 'apreensoes_drogas' ? 'drogasGeral' : null
		};
	});
}

/**
 * Retorna a chave de armas configurada no modelo.
 */
export function getArmasKey(modeloOperacional: ModeloQuestion[] | undefined): string {
	const q = (modeloOperacional || []).find((q) => q.tipo === 'armas_complex');
	return q?.key ?? 'apreensoes_armas_bool';
}

/**
 * Quais dos três blocos FIXOS do painel operacional esta operação comporta.
 *
 * Prisões, drogas e armas não saem do modelo como os demais gráficos: são seis
 * cards escritos no código, que leem chaves cravadas do blob (`drogas_detalhe`,
 * `armas_detalhe`, `prisoes_qtd`, `mandados_qtd`). Existem assim porque o que
 * interessa neles é o DETALHE — peso por tipo de droga, quantidade por tipo de
 * arma —, e nenhum gráfico de barras genérico dá conta disso.
 *
 * O preço era aparecerem SEMPRE. Numa operação nova, cujo formulário nunca teve
 * pergunta de droga, os seis cards apareciam zerados; apagar o campo do
 * formulário não os removia, porque eles nunca dependeram do campo. Era a tela
 * afirmando "nenhuma apreensão" sobre uma pergunta que ninguém fez.
 *
 * A checagem é por TIPO e não por `key`: é o tipo que decide onde o formulário
 * grava (`RelatorioProdutividade` escreve `drogas_detalhe` para todo
 * `drogas_complex`), e a `key` pode ser outra em modelo clonado e renomeado.
 */
export function blocosFixosDisponiveis(modelo: ModeloQuestion[] | undefined | null): {
	prisoes: boolean;
	drogas: boolean;
	armas: boolean;
} {
	const tipos = new Set((modelo ?? []).map((q) => q.tipo));
	return {
		// Duas fontes, e basta uma: o card soma flagrantes (`prisoes_maiores`) e
		// mandados (`mandados_maiores`), e um formulário pode ter só um dos dois.
		prisoes: tipos.has('prisoes_maiores') || tipos.has('mandados_maiores'),
		drogas: tipos.has('drogas_complex'),
		armas: tipos.has('armas_complex')
	};
}
