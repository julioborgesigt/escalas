/**
 * Indicadores de meta: quais perguntas do formulário viram série acompanhada, de
 * onde sai o número realizado, e o que a meta significa em valor absoluto.
 *
 * Existe como módulo único porque as MESMAS três respostas são precisas em
 * quatro telas que não se conhecem — o editor do Admin Geral, a aba de dados
 * base do admin de unidade, o campo de base dentro do formulário de
 * produtividade e os gráficos de `/produtividade`. É exatamente a forma dos bugs
 * catalogados no `CLAUDE.md`: lógica copiada, uma cópia consertada, as outras
 * não. Aqui a pior seria a das CHAVES, e ela já mordeu este projeto uma vez (ver
 * o cabeçalho de `tipos-pergunta.ts`).
 *
 * ## Duas chaves, não uma
 *
 * `pergunta.key` identifica a PERGUNTA e é o que a linha de base referencia:
 * gerada na criação, nunca editável na UI, estável. Mas a RESPOSTA nem sempre
 * mora nela — nos tipos de lista o número está em `${key}__qtd`. A tradução é de
 * `chavesLista()`, e é reusada aqui em vez de reescrita.
 *
 * ## Meta percentual × absoluta
 *
 * Percentual é relativo à linha de base ("redução mínima de 20% do acervo") e
 * por isso EXIGE que a unidade informe a base. Absoluta é um alvo fixo ("mínimo
 * de 1 por unidade/mês") e não exige nada — não há valor anterior a comparar.
 * Essa diferença é o que decide se a delegacia vê ou não o campo de base, então
 * ela mora em `exigeLinhaBase()` e não espalhada em `if`s pelas telas.
 */
import type { GiseModeloPerguntaConfig, IndicadorConfig } from '$lib/types';
import { chavesLista } from './tipos-pergunta';

/**
 * Tipos de pergunta que podem ser indicador: os que produzem um NÚMERO por
 * relatório, e só eles.
 *
 * Texto livre não agrega; `sim_nao` responde outra coisa (proporção, não
 * volume). Os tipos de lista entram porque têm quantidade — é o `__qtd` que
 * `chaveResposta` resolve.
 *
 * Deliberadamente mais restrito que `CHARTABLE_TYPES` de `$lib/produtividade`:
 * aquele decide o que vira gráfico de barras qualquer; este, o que pode ter meta
 * e linha de base.
 */
export const TIPOS_INDICADORAVEIS: readonly string[] = [
	'numero',
	'select_99',
	'select_999',
	'lista_detalhada',
	'mandados_maiores',
	'prisoes_maiores',
	'apreensoes_menores',
	'celulares_complex',
	'analise_complex',
	'relatorios_seint_complex',
	'foragidos_complex',
	'operacoes_seint_complex',
	'operacoes_seint_pura'
];

/** Um indicador já resolvido: a pergunta, a meta e onde ler a resposta dela. */
export interface Indicador {
	/** `pergunta.key` — a referência estável, e o que `operacao_linha_base.indicador_key` guarda. */
	key: string;
	/** Onde a RESPOSTA está no blob. Igual a `key`, exceto nos tipos de lista. */
	chaveResposta: string;
	/** O enunciado da pergunta, para rótulo de gráfico e de campo. */
	texto: string;
	tipo: string;
	config: IndicadorConfig;
}

/** O tipo aceita meta? Único lugar que responde — usado pelo editor e na validação. */
export function podeSerIndicador(tipo: string): boolean {
	return TIPOS_INDICADORAVEIS.includes(tipo);
}

/**
 * Onde a resposta desta pergunta está no blob gravado.
 *
 * Nos tipos de lista é a chave de QUANTIDADE (`${key}__qtd` ou a fixa do tipo);
 * nos demais é a própria `key`. Reusa `chavesLista` de propósito: uma segunda
 * implementação divergiria em silêncio e o indicador simplesmente leria zero.
 */
export function chaveResposta(p: { tipo: string; key: string }): string {
	return chavesLista(p)?.qtd ?? p.key;
}

/**
 * A meta deste indicador exige linha de base da unidade?
 *
 * Só a percentual — ela é uma fração de um valor anterior, e sem esse valor não
 * há meta nenhuma a calcular. A absoluta já é o alvo.
 */
export function exigeLinhaBase(ind: IndicadorConfig): boolean {
	return ind.metaTipo === 'percentual';
}

/**
 * Todos os indicadores de um modelo, na ordem em que aparecem no formulário.
 *
 * Percorre também os `filhos`: uma pergunta condicional ("se Sim, quantos?") é
 * um lugar legítimo para um indicador, e ignorá-los faria a meta configurada no
 * editor sumir do gráfico sem aviso.
 *
 * Deduplica por `key` mantendo a PRIMEIRA ocorrência. A `key` é gerada na
 * criação e não é editável, então repetição aqui só acontece por modelo
 * importado ou clonado à mão — e duas linhas com a mesma `key` colidiriam no
 * índice único de `operacao_linha_base`.
 */
export function extrairIndicadores(
	perguntas: GiseModeloPerguntaConfig[] | null | undefined
): Indicador[] {
	const achados: Indicador[] = [];
	const vistas = new Set<string>();

	function andar(lista: GiseModeloPerguntaConfig[]) {
		for (const p of lista) {
			if (p.indicador && podeSerIndicador(p.tipo) && !vistas.has(p.key)) {
				vistas.add(p.key);
				achados.push({
					key: p.key,
					chaveResposta: chaveResposta(p),
					texto: p.texto,
					tipo: p.tipo,
					config: p.indicador
				});
			}
			if (p.filhos?.length) andar(p.filhos);
		}
	}

	andar(perguntas ?? []);
	return achados;
}

/**
 * Os indicadores de VÁRIOS modelos (operacional + SEINT da mesma operação),
 * unificados.
 *
 * A mesma `key` pode estar nos dois formulários — é o caso quando o indicador
 * vale para a operação inteira, não para um tipo de equipe. A linha de base é da
 * UNIDADE, não da equipe, então ela é uma só: deduplicar aqui é o que impede a
 * aba de dados base de pedir o mesmo número duas vezes.
 */
export function extrairIndicadoresDeModelos(
	modelos: Array<GiseModeloPerguntaConfig[] | null | undefined>
): Indicador[] {
	const porChave = new Map<string, Indicador>();
	for (const modelo of modelos) {
		for (const ind of extrairIndicadores(modelo)) {
			if (!porChave.has(ind.key)) porChave.set(ind.key, ind);
		}
	}
	return [...porChave.values()];
}

/**
 * O valor que a operação persegue, em número absoluto.
 *
 * Percentual aplica a variação sobre a base, na direção do objetivo: base 1.240
 * com "diminuir 20%" vira 992. Absoluta devolve o próprio alvo e ignora a base.
 *
 * `null` quando falta a base de um indicador percentual — não há meta a exibir,
 * e devolver 0 faria um gráfico afirmar que a meta é zerar o acervo.
 */
export function metaAbsoluta(base: number | null | undefined, ind: IndicadorConfig): number | null {
	if (ind.metaTipo === 'absoluto') return ind.metaValor;
	if (base == null || !Number.isFinite(base)) return null;
	const fator = ind.objetivo === 'diminuir' ? 1 - ind.metaValor / 100 : 1 + ind.metaValor / 100;
	return base * fator;
}

/**
 * Quanto da meta foi cumprido, em porcentagem (100 = meta batida; passa de 100
 * quando supera).
 *
 * Para `diminuir`, o progresso é o quanto ANDOU da base em direção à meta —
 * `(base − atual) / (base − meta)`. Não é `atual / meta`: com base 1.000, meta
 * 800 e realizado 900, `atual/meta` daria 112%, dizendo que superou a meta
 * quando na verdade fez metade do caminho.
 *
 * `null` quando não há como calcular: falta base num indicador percentual, ou o
 * denominador é zero (base já igual à meta — não há distância a percorrer, e
 * dividir daria ±∞).
 */
export function percentualAtingimento(
	base: number | null | undefined,
	atual: number,
	ind: IndicadorConfig
): number | null {
	const meta = metaAbsoluta(base, ind);
	if (meta == null || !Number.isFinite(atual)) return null;

	if (ind.metaTipo === 'absoluto') {
		if (ind.objetivo === 'diminuir') {
			// Sem base, "diminuir até no máximo N" só tem duas leituras honestas:
			// dentro do teto (100%) ou fora dele, proporcional a quanto excedeu.
			if (atual <= meta) return 100;
			return meta === 0 ? 0 : Math.max(0, (meta / atual) * 100);
		}
		return meta === 0 ? 100 : (atual / meta) * 100;
	}

	if (base == null) return null;
	const distancia = meta - base;
	if (distancia === 0) return null;
	return ((atual - base) / distancia) * 100;
}

/** A meta foi atingida? `null` quando não há como saber (mesma razão de `percentualAtingimento`). */
export function metaAtingida(
	base: number | null | undefined,
	atual: number,
	ind: IndicadorConfig
): boolean | null {
	const meta = metaAbsoluta(base, ind);
	if (meta == null || !Number.isFinite(atual)) return null;
	return ind.objetivo === 'diminuir' ? atual <= meta : atual >= meta;
}

/**
 * Soma o valor deste indicador num conjunto de respostas já parseadas.
 *
 * Trata ausente, `null`, `''` e texto não-numérico como 0 — o blob é gravado por
 * formulário e sempre teve buracos (pergunta acrescentada depois de respostas já
 * existirem é o caso normal, não a exceção).
 */
export function somarIndicador(
	respostas: Array<Record<string, unknown>>,
	ind: Pick<Indicador, 'chaveResposta'>
): number {
	let total = 0;
	for (const r of respostas) {
		const bruto = r[ind.chaveResposta];
		const n = typeof bruto === 'number' ? bruto : Number(bruto);
		if (Number.isFinite(n)) total += n;
	}
	return total;
}
