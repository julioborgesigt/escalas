import { describe, it, expect } from 'vitest';
import { montarPainelIndicadores, formatarValorIndicador } from '../metas';
import type { Indicador } from '$lib/gise/indicadores';

/** Acervo de inquéritos: reduzir 20% — o indicador principal do plano da CRAJUBAR. */
const ACERVO: Indicador = {
	key: 'acervo',
	chaveResposta: 'acervo',
	texto: 'Acervo de inquéritos pendentes',
	tipo: 'numero',
	config: { objetivo: 'diminuir', metaTipo: 'percentual', metaValor: 20 }
};

/** "Mínimo de 1 por unidade/mês" — meta absoluta, sem linha de base. */
const ORCRIM: Indicador = {
	key: 'orcrim',
	chaveResposta: 'orcrim',
	texto: 'Investigações qualificadas de ORCRIM',
	tipo: 'numero',
	config: { objetivo: 'aumentar', metaTipo: 'absoluto', metaValor: 1 }
};

const CRATO = { id: 10, nome: 'DELEGACIA DO CRATO' };
const BARBALHA = { id: 20, nome: 'DELEGACIA DE BARBALHA' };

describe('montarPainelIndicadores', () => {
	it('cruza base, realizado e meta por unidade', () => {
		const painel = montarPainelIndicadores(
			[ACERVO],
			[CRATO],
			[{ unidade_id: 10, respostasParsed: { acervo: 1100 } }],
			[{ unidade_id: 10, indicador_key: 'acervo', valor: 1240 }]
		);

		expect(painel).toHaveLength(1);
		const linha = painel[0].linhas[0];
		expect(linha.base).toBe(1240);
		expect(linha.realizado).toBe(1100);
		expect(linha.meta).toBe(992);
		// (1240 − 1100) / (1240 − 992) = 140/248 ≈ 56,45%
		expect(linha.atingimento).toBeCloseTo(56.45, 1);
		expect(linha.atingida).toBe(false);
	});

	it('soma as respostas da MESMA unidade', () => {
		const painel = montarPainelIndicadores(
			[ACERVO],
			[CRATO],
			[
				{ unidade_id: 10, respostasParsed: { acervo: 400 } },
				{ unidade_id: 10, respostasParsed: { acervo: 300 } }
			],
			[{ unidade_id: 10, indicador_key: 'acervo', valor: 1000 }]
		);
		expect(painel[0].linhas[0].realizado).toBe(700);
	});

	it('não mistura unidades — cada uma tem a própria base e o próprio realizado', () => {
		const painel = montarPainelIndicadores(
			[ACERVO],
			[CRATO, BARBALHA],
			[
				{ unidade_id: 10, respostasParsed: { acervo: 100 } },
				{ unidade_id: 20, respostasParsed: { acervo: 900 } }
			],
			[
				{ unidade_id: 10, indicador_key: 'acervo', valor: 200 },
				{ unidade_id: 20, indicador_key: 'acervo', valor: 1000 }
			]
		);
		const [crato, barbalha] = painel[0].linhas;
		expect([crato.base, crato.realizado]).toEqual([200, 100]);
		expect([barbalha.base, barbalha.realizado]).toEqual([1000, 900]);
	});

	it('unidade sem resposta nenhuma aparece com realizado 0, não some', () => {
		// Sumir esconderia justamente quem não produziu.
		const painel = montarPainelIndicadores(
			[ACERVO],
			[CRATO, BARBALHA],
			[{ unidade_id: 10, respostasParsed: { acervo: 5 } }],
			[]
		);
		expect(painel[0].linhas.map((l) => l.unidadeNome)).toEqual([
			'DELEGACIA DO CRATO',
			'DELEGACIA DE BARBALHA'
		]);
		expect(painel[0].linhas[1].realizado).toBe(0);
	});

	it('preserva a ordem das unidades recebidas', () => {
		const painel = montarPainelIndicadores([ACERVO], [BARBALHA, CRATO], [], []);
		expect(painel[0].linhas.map((l) => l.unidadeId)).toEqual([20, 10]);
	});

	it('sem base, o indicador percentual fica sem meta e marcado como pendente', () => {
		const painel = montarPainelIndicadores(
			[ACERVO],
			[CRATO],
			[{ unidade_id: 10, respostasParsed: { acervo: 500 } }],
			[]
		);
		const linha = painel[0].linhas[0];
		expect(linha.base).toBeNull();
		expect(linha.meta).toBeNull();
		expect(linha.atingimento).toBeNull();
		expect(linha.basePendente).toBe(true);
		expect(painel[0].basesPendentes).toBe(1);
	});

	it('meta absoluta não exige base e nunca fica pendente', () => {
		const painel = montarPainelIndicadores(
			[ORCRIM],
			[CRATO],
			[{ unidade_id: 10, respostasParsed: { orcrim: 2 } }],
			[]
		);
		const linha = painel[0].linhas[0];
		expect(linha.basePendente).toBe(false);
		expect(linha.meta).toBe(1);
		expect(linha.atingida).toBe(true);
	});

	it('resume quantas unidades bateram a meta, ignorando as sem meta calculável', () => {
		const painel = montarPainelIndicadores(
			[ACERVO],
			[CRATO, BARBALHA],
			[
				{ unidade_id: 10, respostasParsed: { acervo: 700 } },
				{ unidade_id: 20, respostasParsed: { acervo: 999 } }
			],
			// Só o Crato informou a base — Barbalha não entra na conta.
			[{ unidade_id: 10, indicador_key: 'acervo', valor: 1000 }]
		);
		expect(painel[0].unidadesComMeta).toBe(1);
		expect(painel[0].unidadesAtingiram).toBe(1);
		expect(painel[0].basesPendentes).toBe(1);
	});

	it('resposta sem unidade (quadro de supervisão) não entra em unidade nenhuma', () => {
		const painel = montarPainelIndicadores(
			[ACERVO],
			[CRATO],
			[
				{ unidade_id: null, respostasParsed: { acervo: 999 } },
				{ unidade_id: 10, respostasParsed: { acervo: 5 } }
			],
			[]
		);
		expect(painel[0].linhas[0].realizado).toBe(5);
	});

	it('usa a chaveResposta, não a key, nos tipos de lista', () => {
		const lista: Indicador = {
			key: 'extra_1',
			chaveResposta: 'extra_1__qtd',
			texto: 'Relatórios',
			tipo: 'lista_detalhada',
			config: { objetivo: 'aumentar', metaTipo: 'absoluto', metaValor: 3 }
		};
		const painel = montarPainelIndicadores(
			[lista],
			[CRATO],
			[{ unidade_id: 10, respostasParsed: { extra_1: 'ignorar', extra_1__qtd: 4 } }],
			[]
		);
		expect(painel[0].linhas[0].realizado).toBe(4);
		expect(painel[0].linhas[0].atingida).toBe(true);
	});

	it('sem indicadores, devolve lista vazia', () => {
		expect(montarPainelIndicadores([], [CRATO], [], [])).toEqual([]);
	});
});

describe('formatarValorIndicador', () => {
	it('formata em pt-BR sem decimal desnecessário', () => {
		expect(formatarValorIndicador(1240)).toBe('1.240');
	});

	it('preserva a casa decimal de uma média em dias', () => {
		// 187,5 dias arredondado para 188 mudaria o resultado da meta de 15%.
		expect(formatarValorIndicador(187.5)).toBe('187,5');
	});

	it('nulo e não-finito viram travessão', () => {
		expect(formatarValorIndicador(null)).toBe('—');
		expect(formatarValorIndicador(Number.NaN)).toBe('—');
	});
});
