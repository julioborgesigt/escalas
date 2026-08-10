import { describe, it, expect } from 'vitest';
import type { GiseModeloPerguntaConfig, IndicadorConfig } from '$lib/types';
import {
	TIPOS_INDICADORAVEIS,
	podeSerIndicador,
	chaveResposta,
	exigeLinhaBase,
	extrairIndicadores,
	extrairIndicadoresDeModelos,
	metaAbsoluta,
	percentualAtingimento,
	metaAtingida,
	somarIndicador
} from '../indicadores';

/** Meta de 20% de REDUÇÃO — a do acervo de inquéritos no plano da CRAJUBAR. */
const REDUZIR_20: IndicadorConfig = {
	objetivo: 'diminuir',
	metaTipo: 'percentual',
	metaValor: 20
};

/** Meta de 15% de AUMENTO — a de inquéritos de CVLI concluídos. */
const AUMENTAR_15: IndicadorConfig = {
	objetivo: 'aumentar',
	metaTipo: 'percentual',
	metaValor: 15
};

/** "Mínimo de 1 por unidade/mês" — sem linha de base. */
const MINIMO_1: IndicadorConfig = {
	objetivo: 'aumentar',
	metaTipo: 'absoluto',
	metaValor: 1
};

function pergunta(over: Partial<GiseModeloPerguntaConfig>): GiseModeloPerguntaConfig {
	return { id: 1, texto: 'Pergunta', tipo: 'numero', key: 'k', ...over };
}

describe('podeSerIndicador', () => {
	it('aceita os tipos contáveis e recusa os que não produzem número', () => {
		expect(podeSerIndicador('numero')).toBe(true);
		expect(podeSerIndicador('lista_detalhada')).toBe(true);
		expect(podeSerIndicador('texto')).toBe(false);
		expect(podeSerIndicador('textarea')).toBe(false);
		// `sim_nao` responde proporção, não volume — não é indicador de meta.
		expect(podeSerIndicador('sim_nao')).toBe(false);
	});

	it('a lista pública e o predicado não divergem', () => {
		for (const t of TIPOS_INDICADORAVEIS) expect(podeSerIndicador(t)).toBe(true);
	});
});

describe('chaveResposta', () => {
	it('usa a própria key nos tipos simples', () => {
		expect(chaveResposta({ tipo: 'numero', key: 'crajubar_acervo' })).toBe('crajubar_acervo');
	});

	it('usa a chave de QUANTIDADE nos tipos de lista — não a key da pergunta', () => {
		// É a armadilha do cabeçalho de tipos-pergunta: a resposta não mora na key.
		expect(chaveResposta({ tipo: 'lista_detalhada', key: 'extra_17' })).toBe('extra_17__qtd');
		expect(chaveResposta({ tipo: 'prisoes_maiores', key: 'qualquer' })).toBe('prisoes_qtd');
	});
});

describe('exigeLinhaBase', () => {
	it('percentual exige base; absoluto não', () => {
		expect(exigeLinhaBase(REDUZIR_20)).toBe(true);
		expect(exigeLinhaBase(MINIMO_1)).toBe(false);
	});
});

describe('extrairIndicadores', () => {
	it('devolve vazio para modelo nulo, vazio ou sem indicador', () => {
		expect(extrairIndicadores(null)).toEqual([]);
		expect(extrairIndicadores([])).toEqual([]);
		expect(extrairIndicadores([pergunta({})])).toEqual([]);
	});

	it('encontra indicador em pergunta FILHA — não só no nível 0', () => {
		const modelo = [
			pergunta({
				id: 1,
				key: 'pai',
				tipo: 'sim_nao',
				filhos: [pergunta({ id: 2, key: 'filho_qtd', tipo: 'numero', indicador: AUMENTAR_15 })]
			})
		];
		expect(extrairIndicadores(modelo).map((i) => i.key)).toEqual(['filho_qtd']);
	});

	it('ignora indicador marcado em tipo que não aceita meta', () => {
		const modelo = [pergunta({ tipo: 'texto', key: 'livre', indicador: REDUZIR_20 })];
		expect(extrairIndicadores(modelo)).toEqual([]);
	});

	it('deduplica por key, mantendo a primeira ocorrência', () => {
		const modelo = [
			pergunta({ id: 1, key: 'dup', texto: 'Primeira', indicador: REDUZIR_20 }),
			pergunta({ id: 2, key: 'dup', texto: 'Segunda', indicador: AUMENTAR_15 })
		];
		const achados = extrairIndicadores(modelo);
		expect(achados).toHaveLength(1);
		expect(achados[0].texto).toBe('Primeira');
	});

	it('preserva a ordem do formulário', () => {
		const modelo = [
			pergunta({ id: 1, key: 'a', indicador: REDUZIR_20 }),
			pergunta({ id: 2, key: 'b', tipo: 'texto' }),
			pergunta({ id: 3, key: 'c', indicador: AUMENTAR_15 })
		];
		expect(extrairIndicadores(modelo).map((i) => i.key)).toEqual(['a', 'c']);
	});

	it('resolve a chave de resposta do tipo de lista', () => {
		const modelo = [pergunta({ key: 'extra_99', tipo: 'lista_detalhada', indicador: AUMENTAR_15 })];
		expect(extrairIndicadores(modelo)[0].chaveResposta).toBe('extra_99__qtd');
	});
});

describe('extrairIndicadoresDeModelos', () => {
	it('unifica operacional e SEINT sem repetir a mesma key', () => {
		// A base é da UNIDADE, não da equipe: pedir duas vezes seria pedir o mesmo
		// número duas vezes na aba de dados base.
		const op = [pergunta({ key: 'acervo', indicador: REDUZIR_20 })];
		const seint = [
			pergunta({ key: 'acervo', indicador: REDUZIR_20 }),
			pergunta({ key: 'so_seint', indicador: AUMENTAR_15 })
		];
		expect(extrairIndicadoresDeModelos([op, seint]).map((i) => i.key)).toEqual([
			'acervo',
			'so_seint'
		]);
	});

	it('tolera modelo nulo na lista', () => {
		expect(extrairIndicadoresDeModelos([null, undefined])).toEqual([]);
	});
});

describe('metaAbsoluta', () => {
	it('reduz a base pelo percentual — 1240 com -20% vira 992', () => {
		expect(metaAbsoluta(1240, REDUZIR_20)).toBe(992);
	});

	it('aumenta a base pelo percentual — 40 com +15% vira 46', () => {
		expect(metaAbsoluta(40, AUMENTAR_15)).toBeCloseTo(46);
	});

	it('meta absoluta ignora a base', () => {
		expect(metaAbsoluta(null, MINIMO_1)).toBe(1);
		expect(metaAbsoluta(500, MINIMO_1)).toBe(1);
	});

	it('sem base num indicador percentual devolve null, não zero', () => {
		// Zero faria o gráfico afirmar que a meta é zerar o acervo.
		expect(metaAbsoluta(null, REDUZIR_20)).toBeNull();
		expect(metaAbsoluta(undefined, REDUZIR_20)).toBeNull();
		expect(metaAbsoluta(Number.NaN, REDUZIR_20)).toBeNull();
	});
});

describe('percentualAtingimento', () => {
	it('mede o caminho ANDADO entre base e meta ao diminuir', () => {
		// base 1000, meta 800: realizado 900 é metade do caminho, não 112%.
		expect(percentualAtingimento(1000, 900, REDUZIR_20)).toBeCloseTo(50);
		expect(percentualAtingimento(1000, 800, REDUZIR_20)).toBeCloseTo(100);
		expect(percentualAtingimento(1000, 1000, REDUZIR_20)).toBeCloseTo(0);
	});

	it('passa de 100% quando supera a meta', () => {
		expect(percentualAtingimento(1000, 700, REDUZIR_20)!).toBeGreaterThan(100);
	});

	it('fica negativo quando anda para o lado errado', () => {
		expect(percentualAtingimento(1000, 1100, REDUZIR_20)!).toBeLessThan(0);
	});

	it('mede o caminho andado ao aumentar', () => {
		// base 100, meta 115: realizado 115 é 100%.
		expect(percentualAtingimento(100, 115, AUMENTAR_15)).toBeCloseTo(100);
		expect(percentualAtingimento(100, 107.5, AUMENTAR_15)).toBeCloseTo(50);
	});

	it('base zero num indicador percentual não divide por zero', () => {
		// meta = 0 e base = 0: não há distância a percorrer.
		expect(percentualAtingimento(0, 5, REDUZIR_20)).toBeNull();
		expect(percentualAtingimento(0, 5, AUMENTAR_15)).toBeNull();
	});

	it('sem base num indicador percentual devolve null', () => {
		expect(percentualAtingimento(null, 5, REDUZIR_20)).toBeNull();
	});

	it('meta absoluta de aumento é proporção direta do alvo', () => {
		expect(percentualAtingimento(null, 2, MINIMO_1)).toBeCloseTo(200);
		expect(percentualAtingimento(null, 0, MINIMO_1)).toBeCloseTo(0);
	});

	it('meta absoluta de redução é teto: dentro dele, 100%', () => {
		const teto: IndicadorConfig = { objetivo: 'diminuir', metaTipo: 'absoluto', metaValor: 30 };
		expect(percentualAtingimento(null, 30, teto)).toBe(100);
		expect(percentualAtingimento(null, 10, teto)).toBe(100);
		expect(percentualAtingimento(null, 60, teto)).toBeCloseTo(50);
	});
});

describe('metaAtingida', () => {
	it('diminuir: atingida quando chega igual ou abaixo da meta', () => {
		expect(metaAtingida(1000, 800, REDUZIR_20)).toBe(true);
		expect(metaAtingida(1000, 801, REDUZIR_20)).toBe(false);
	});

	it('aumentar: atingida quando chega igual ou acima da meta', () => {
		expect(metaAtingida(100, 115, AUMENTAR_15)).toBe(true);
		expect(metaAtingida(100, 114, AUMENTAR_15)).toBe(false);
	});

	it('null quando falta a base de um indicador percentual', () => {
		expect(metaAtingida(null, 800, REDUZIR_20)).toBeNull();
	});

	it('meta absoluta dispensa base', () => {
		expect(metaAtingida(null, 1, MINIMO_1)).toBe(true);
		expect(metaAtingida(null, 0, MINIMO_1)).toBe(false);
	});
});

describe('somarIndicador', () => {
	const ind = { chaveResposta: 'acervo' };

	it('soma os números presentes', () => {
		expect(somarIndicador([{ acervo: 10 }, { acervo: 5 }], ind)).toBe(15);
	});

	it('trata ausente, null, vazio e texto como zero', () => {
		// Pergunta acrescentada depois de já haver respostas é o caso NORMAL.
		expect(
			somarIndicador([{}, { acervo: null }, { acervo: '' }, { acervo: 'abc' }, { acervo: 7 }], ind)
		).toBe(7);
	});

	it('aceita número em string, como o formulário grava', () => {
		expect(somarIndicador([{ acervo: '12' }, { acervo: '3' }], ind)).toBe(15);
	});
});
