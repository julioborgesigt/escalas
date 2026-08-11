/**
 * Quais perguntas do formulário viram card no painel, em que FORMA, e onde ler a
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
 * Agora quem decide é `pergunta.grafico`, marcada no editor, e ela diz mais que
 * sim ou não: diz QUAIS das três formas a pergunta gera (colunas, ranking,
 * detalhamento). O tipo continua valendo, mas só como VETO — uma pergunta
 * marcada cujo tipo deixou de ser graficável (o admin trocou `numero` por
 * `textarea` depois) é descartada aqui, senão o painel tentaria somar prosa. O
 * mesmo vale para `detalhe` num tipo sem quebra por categoria.
 *
 * ## `key` × `mappedKey`
 *
 * `key` identifica a PERGUNTA; a RESPOSTA nem sempre mora nela. Nos tipos
 * compostos o número está numa chave fixa do blob (`celulares_qtd`), e é
 * `mappedKey` que faz a tradução. Confundir as duas dá gráfico zerado sem erro
 * nenhum — o painel soma `undefined` e mostra barra vazia.
 */

import { podeSerGrafico, podeDetalhar } from '$lib/gise/tipos-pergunta';
import { identidadeDaPergunta, temAlgumaForma, formasDaMarca } from './apresentacao';
import type { GiseModeloPerguntaConfig, GraficoConfig } from '$lib/types';

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

/** Uma pergunta do modelo já resolvida para o painel. */
export interface Question {
	id: number;
	/** O texto da pergunta, como o admin o escreveu. */
	label: string;
	key: string;
	mappedKey: string;
	tipo: string;
	color: string;
	isBool: boolean;
	/** Título do card: preserva "Drogas"/"Armas"; nas demais, é o próprio `label`. */
	titulo: string;
	/** `'g'` em drogas (mostrado em kg), vazio no resto. */
	unidade: string;
	/** Quais cards esta pergunta gera, já filtradas pelo que o tipo comporta. */
	formas: Required<GraficoConfig>;
}

type ModeloQuestion = Pick<GiseModeloPerguntaConfig, 'id' | 'texto' | 'key' | 'tipo'> & {
	/** `boolean` é a forma anterior à migração 0054 — ver `formasDaMarca`. */
	grafico?: GraficoConfig | boolean;
	filhos?: ModeloQuestion[];
};

/**
 * Converte o modelo cru nas perguntas que vão ao painel, na ordem do formulário.
 *
 * Duas condições, as duas necessárias: a pergunta tem ao menos uma FORMA marcada
 * e o tipo dela comporta gráfico (ver o cabeçalho). Cada uma recebe `mappedKey`,
 * a identidade do card e uma cor fixa pela posição — a mesma pergunta mantém a
 * mesma cor entre as três formas.
 *
 * `detalhe` é peneirada à parte: uma pergunta pode carregar a marca de um tipo
 * que a comportava e ter mudado de tipo depois, e detalhar o que não tem quebra
 * por categoria daria um card de uma barra só.
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
			if (temAlgumaForma(q.grafico) && podeSerGrafico(q.tipo)) marcadas.push(q);
			if (q.filhos?.length) andar(q.filhos);
		}
	}
	andar(modelo);

	return (
		marcadas
			.map((q, idx: number) => {
				const cor = palette[idx % palette.length];
				const identidade = identidadeDaPergunta(q.tipo, q.texto, cor);
				const marcadas = formasDaMarca(q.grafico);
				const formas = {
					...marcadas,
					detalhe: marcadas.detalhe && podeDetalhar(q.tipo)
				};
				return {
					id: q.id,
					label: q.texto,
					key: q.key,
					mappedKey: KEY_MAP[q.tipo] ?? q.key,
					tipo: q.tipo,
					color: identidade.cor,
					isBool: q.tipo === 'sim_nao',
					titulo: identidade.titulo,
					unidade: identidade.unidade,
					formas
				};
			})
			// A peneira do `detalhe` pode ter zerado as formas de uma pergunta que só
			// pedia detalhamento. Sem card nenhum, ela não é uma pergunta do painel.
			.filter((q) => q.formas.colunas || q.formas.ranking || q.formas.detalhe)
	);
}

/**
 * O bloco de PRISÕES aparece nesta operação?
 *
 * Restou um só. Drogas e armas eram blocos escritos no código como este e viraram
 * marcação da pergunta: peso por tipo de droga e quantidade por tipo de arma são
 * quebras que a própria resposta guarda, então cabem na forma `detalhe` de
 * qualquer pergunta daqueles tipos.
 *
 * Prisões não cabe, e é por isso que continua aqui: o detalhamento dele soma
 * TRÊS perguntas diferentes — flagrantes (`prisoes_qtd`, da pergunta
 * `prisoes_maiores`), mandados (`mandados_qtd`, de `mandados_maiores`) e o total
 * de presos (`prisoes_apreensoes_flagrante`). Uma marca vive numa pergunta e não
 * consegue descrever um card que atravessa três.
 *
 * A checagem é por TIPO e não por `key`: é o tipo que decide onde o formulário
 * grava (`chavesLista` em `$lib/gise/tipos-pergunta`), e a `key` pode ser outra
 * em modelo clonado e renomeado.
 *
 * Antes disto o bloco aparecia SEMPRE. Numa operação nova, cujo formulário nunca
 * perguntou sobre flagrante, os dois cards apareciam zerados — a tela afirmando
 * "nenhuma prisão" sobre uma pergunta que ninguém fez.
 */
export function temBlocoPrisoes(modelo: ModeloQuestion[] | undefined | null): boolean {
	const tipos = new Set((modelo ?? []).map((q) => q.tipo));
	// Duas fontes, e basta uma: o card soma flagrantes e mandados, e um formulário
	// pode ter só um dos dois.
	return tipos.has('prisoes_maiores') || tipos.has('mandados_maiores');
}
