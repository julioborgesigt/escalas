/**
 * Mapeamento dinâmico de perguntas do formulário GISE.
 * Transforma o modelo cru em perguntas processadas com cores, tipos e chaves mapeadas.
 */

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

const CHARTABLE_TYPES = [
	'numero',
	'select_99',
	'select_999',
	'sim_nao',
	'celulares_complex',
	'analise_complex',
	'relatorios_seint_complex',
	'foragidos_complex',
	'operacoes_seint_complex',
	'operacoes_seint_pura'
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

type ModeloQuestion = { id: number; texto: string; key: string; tipo: string };

/**
 * Converte o modelo cru de perguntas em perguntas prontas para gráfico.
 *
 * Só sobrevivem os tipos de `CHARTABLE_TYPES`: pergunta de texto livre não
 * agrega em nada. Cada uma recebe `mappedKey` (a chave onde a RESPOSTA de fato
 * está no blob, que difere da `key` da pergunta nos tipos compostos) e uma cor
 * fixa pela posição — a mesma pergunta mantém a mesma cor entre os gráficos.
 *
 * Recebe o modelo já escolhido pelo chamador (operacional ou SEINT); não decide
 * qual usar.
 */
export function mapQuestions(modelo: ModeloQuestion[] | undefined | null): Question[] {
	if (!modelo || modelo.length === 0) return [];

	return modelo
		.filter((q) => CHARTABLE_TYPES.includes(q.tipo))
		.map((q, idx: number) => {
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
