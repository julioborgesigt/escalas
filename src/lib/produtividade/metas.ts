/**
 * Agregação dos INDICADORES para o painel: linha de base × realizado × meta,
 * por unidade.
 *
 * A conta em si (o que a meta vale em número absoluto, quanto do caminho foi
 * andado) NÃO mora aqui — é de `$lib/gise/indicadores`, que também alimenta o
 * editor, a aba de dados base e o campo dentro do formulário. Este módulo só
 * CRUZA as três origens que o painel tem em mãos:
 *
 *   respostas de produtividade → realizado (soma no período filtrado)
 *   `operacao_linha_base`      → base (o denominador informado pela unidade)
 *   modelo do formulário       → meta (objetivo + percentual/absoluto)
 *
 * Separado da tela porque é a parte verificável: um gráfico não se testa, mas
 * "base 1.240, meta −20%, realizado 1.100 → 56,4% do caminho" se testa.
 */
import {
	metaAbsoluta,
	percentualAtingimento,
	metaAtingida,
	percentualCobertura,
	somarChave,
	exigeLinhaBase,
	type Indicador
} from '$lib/gise/indicadores';

/** Uma resposta já parseada, com a unidade que a produziu. */
export interface RespostaComUnidade {
	unidade_id: number | null;
	respostasParsed: Record<string, unknown>;
}

/**
 * O que uma unidade mostra para um indicador.
 *
 * Não exportado: só existe dentro de `PainelIndicador.linhas`, e a tela o
 * alcança por ali. Exportar o que ninguém importa pelo nome vira uma segunda
 * lista para manter em dia — é a mesma regra do barrel em `lib/db.ts`.
 */
interface LinhaIndicadorUnidade {
	unidadeId: number;
	unidadeNome: string;
	/** `null` = a unidade ainda não informou (indicador percentual sem denominador). */
	base: number | null;
	/** O numerador: o valor somado no período. Na proporção, a PARTE atendida. */
	realizado: number;
	/**
	 * O denominador do período num indicador de proporção — o total existente.
	 * `null` nos demais tipos, onde não há totalizador nenhum a somar.
	 */
	total: number | null;
	/** `realizado / total` em %, só na proporção. `null` quando o total é 0 ou ausente. */
	cobertura: number | null;
	/** `null` quando falta base num indicador percentual — não há meta a desenhar. */
	meta: number | null;
	/** 0–100+, ou `null` quando não há como calcular. */
	atingimento: number | null;
	atingida: boolean | null;
	/** `true` quando a base é exigida e não foi informada — o aviso da tela. */
	basePendente: boolean;
}

/** Um indicador com as linhas de todas as unidades e o resumo do conjunto. */
export interface PainelIndicador {
	indicador: Indicador;
	linhas: LinhaIndicadorUnidade[];
	/** Quantas unidades ainda não informaram a base. Alimenta o aviso do card. */
	basesPendentes: number;
	/** Unidades que bateram a meta, sobre as que têm meta calculável. */
	unidadesAtingiram: number;
	unidadesComMeta: number;
}

/**
 * Cruza indicadores × unidades × respostas.
 *
 * `respostas` já vem FILTRADA pela tela (operação, período, tipo de equipe) —
 * este módulo não filtra nada, só soma o que recebe. É o que mantém a conta
 * coerente com o que o resto do painel mostra: um filtro aplicado aqui dentro
 * divergiria do aplicado lá fora sem ninguém perceber.
 *
 * `unidades` define a ORDEM e o conjunto exibido: unidade participante que ainda
 * não entregou relatório nenhum aparece com realizado 0, em vez de sumir. Sumir
 * esconderia justamente quem não produziu.
 */
export function montarPainelIndicadores(
	indicadores: Indicador[],
	unidades: Array<{ id: number; nome: string }>,
	respostas: RespostaComUnidade[],
	linhaBase: Array<{ unidade_id: number; indicador_key: string; valor: number }>
): PainelIndicador[] {
	// `${unidade}|${indicador}` → valor. Chave composta em vez de mapa aninhado:
	// a leitura é sempre pelos dois juntos.
	const bases = new Map(linhaBase.map((l) => [`${l.unidade_id}|${l.indicador_key}`, l.valor]));

	const porUnidade = new Map<number, RespostaComUnidade[]>();
	for (const r of respostas) {
		if (r.unidade_id == null) continue;
		const lista = porUnidade.get(r.unidade_id);
		if (lista) lista.push(r);
		else porUnidade.set(r.unidade_id, [r]);
	}

	return indicadores.map((indicador) => {
		const precisaBase = exigeLinhaBase(indicador.config);

		const linhas: LinhaIndicadorUnidade[] = unidades.map((u) => {
			const blobs = (porUnidade.get(u.id) ?? []).map((r) => r.respostasParsed);
			const base = bases.get(`${u.id}|${indicador.key}`) ?? null;
			const realizado = somarChave(blobs, indicador.chaveResposta);
			// O total só existe na proporção — e é ELE, não a linha de base, o valor
			// de referência contra o qual a meta daquele indicador se calcula.
			const total = indicador.chaveTotal ? somarChave(blobs, indicador.chaveTotal) : null;
			const referencia = indicador.chaveTotal ? total : base;

			return {
				unidadeId: u.id,
				unidadeNome: u.nome,
				base,
				realizado,
				total,
				cobertura: indicador.chaveTotal ? percentualCobertura(realizado, total) : null,
				meta: metaAbsoluta(referencia, indicador.config),
				atingimento: percentualAtingimento(referencia, realizado, indicador.config),
				atingida: metaAtingida(referencia, realizado, indicador.config),
				basePendente: precisaBase && base == null
			};
		});

		const comMeta = linhas.filter((l) => l.atingida !== null);
		return {
			indicador,
			linhas,
			basesPendentes: linhas.filter((l) => l.basePendente).length,
			unidadesAtingiram: comMeta.filter((l) => l.atingida).length,
			unidadesComMeta: comMeta.length
		};
	});
}

/**
 * Número no formato pt-BR, sem casas decimais desnecessárias.
 *
 * Os indicadores são quase todos contagens inteiras ("procedimentos"), mas
 * "tempo médio de conclusão" é uma média em dias — arredondar tudo para inteiro
 * transformaria 187,5 dias em 188 e faria a meta de redução de 15% parecer
 * cumprida ou não por causa do arredondamento.
 */
export function formatarValorIndicador(v: number | null): string {
	if (v == null || !Number.isFinite(v)) return '—';
	return v.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
}

/**
 * Porcentagem no formato pt-BR, com o símbolo.
 *
 * Uma casa decimal porque cobertura é razão de dois inteiros pequenos: com 7
 * ocorrências e 5 atendidas, arredondar para inteiro daria 71% e esconderia que
 * a conta é 71,4 — e a meta de 100% se lê pela distância até ela.
 */
export function formatarPercentual(v: number | null): string {
	if (v == null || !Number.isFinite(v)) return '—';
	return `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
}
