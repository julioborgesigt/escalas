import { describe, it, expect } from 'vitest';
import {
	chaveDoGrupo,
	gruposDaVisualizacao,
	ordenarERecortar,
	descreverRecorte
} from '../agrupamento';

/** Cenário do Cariri: uma seccional com duas delegacias em slot. */
const SECCIONAIS = [
	{ id: 1, nome: '2ª SECCIONAL DO CARIRI' },
	{ id: 2, nome: '1ª SECCIONAL DE FORTALEZA' }
];

const PARTICIPANTES = [
	{ id: 1, nome: '2ª SECCIONAL DO CARIRI', tipo: 'seccional' },
	{ id: 10, nome: 'DELEGACIA DO CRATO', tipo: 'delegacia' },
	{ id: 20, nome: 'DELEGACIA DE BARBALHA', tipo: 'delegacia' }
];

describe('chaveDoGrupo', () => {
	it('lê seccional_id no modo seccionais e unidade_id no de delegacias', () => {
		const linha = { seccional_id: 1, unidade_id: 10 };
		expect(chaveDoGrupo('seccionais')(linha)).toBe(1);
		expect(chaveDoGrupo('delegacias')(linha)).toBe(10);
	});

	it('campo ausente vira null, não zero', () => {
		// Zero é um id possível em teoria; confundir os dois faria a linha cair no
		// grupo errado em vez de ficar de fora.
		expect(chaveDoGrupo('delegacias')({ seccional_id: 1 })).toBeNull();
		expect(chaveDoGrupo('seccionais')({ unidade_id: 10 })).toBeNull();
	});
});

describe('gruposDaVisualizacao — modo seccionais', () => {
	it('o rótulo curto mantém o ordinal, que é o que distingue', () => {
		const grupos = gruposDaVisualizacao('seccionais', {
			seccionais: [{ id: 9, nome: '1ª Seccional do Interior Sul' }],
			unidadesDaOperacao: [],
			linhas: []
		});
		expect(grupos[0].curto).toBe('1ª Seccional');
		expect(grupos[0].nome).toBe('1ª Seccional do Interior Sul');
	});

	it('devolve todas as seccionais cadastradas, inclusive as que não produziram', () => {
		const grupos = gruposDaVisualizacao('seccionais', {
			seccionais: SECCIONAIS,
			unidadesDaOperacao: PARTICIPANTES,
			linhas: [{ seccional_id: 1, unidade_id: 10 }]
		});
		// "Não produziu" é informação: a 1ª de Fortaleza continua na lista, com 0.
		expect(grupos.map((g) => g.id)).toEqual([1, 2]);
	});
});

describe('gruposDaVisualizacao — modo delegacias', () => {
	it('traz as participantes que não são seccional', () => {
		const grupos = gruposDaVisualizacao('delegacias', {
			seccionais: SECCIONAIS,
			unidadesDaOperacao: PARTICIPANTES,
			linhas: []
		});
		expect(grupos.map((g) => g.nome)).toEqual(['DELEGACIA DE BARBALHA', 'DELEGACIA DO CRATO']);
	});

	it('a seccional SEM slot entra como linha própria — foi ela que produziu', () => {
		// Equipe escalada direto na seccional: `unidade_id` resolve para ela mesma.
		// Sem esta linha, a soma do ranking ficaria menor que o total do painel.
		const grupos = gruposDaVisualizacao('delegacias', {
			seccionais: SECCIONAIS,
			unidadesDaOperacao: PARTICIPANTES,
			linhas: [{ seccional_id: 1, unidade_id: 1 }]
		});
		expect(grupos.map((g) => g.id).sort((a, b) => a - b)).toEqual([1, 10, 20]);
	});

	it('seccional que é só "pai" NÃO entra', () => {
		// Todas as equipes dela têm slot: ela não produziu nada por si, e uma linha
		// zerada que não é delegacia só polui o ranking.
		const grupos = gruposDaVisualizacao('delegacias', {
			seccionais: SECCIONAIS,
			unidadesDaOperacao: PARTICIPANTES,
			linhas: [
				{ seccional_id: 1, unidade_id: 10 },
				{ seccional_id: 1, unidade_id: 20 }
			]
		});
		expect(grupos.some((g) => g.id === 1)).toBe(false);
	});

	it('unidade_id sem nome conhecido é ignorada — ranking sem rótulo não se lê', () => {
		const grupos = gruposDaVisualizacao('delegacias', {
			seccionais: SECCIONAIS,
			unidadesDaOperacao: PARTICIPANTES,
			linhas: [{ seccional_id: 1, unidade_id: 999 }]
		});
		expect(grupos.some((g) => g.id === 999)).toBe(false);
	});

	it('o rótulo curto tira o prefixo e deixa o MUNICÍPIO', () => {
		// É o que distingue uma delegacia da outra. A regra das seccionais (cortar
		// depois do "do") deixaria as três chamadas "DELEGACIA".
		const grupos = gruposDaVisualizacao('delegacias', {
			seccionais: SECCIONAIS,
			unidadesDaOperacao: PARTICIPANTES,
			linhas: []
		});
		expect(grupos.map((g) => g.curto)).toEqual(['BARBALHA', 'CRATO']);
	});

	it('ordena por nome, em pt-BR', () => {
		const grupos = gruposDaVisualizacao('delegacias', {
			seccionais: SECCIONAIS,
			unidadesDaOperacao: [
				{ id: 30, nome: 'DELEGACIA DE ÁGUAS BELAS', tipo: 'delegacia' },
				{ id: 10, nome: 'DELEGACIA DO CRATO', tipo: 'delegacia' },
				{ id: 20, nome: 'DELEGACIA DE ABAIARA', tipo: 'delegacia' }
			],
			linhas: []
		});
		expect(grupos.map((g) => g.nome)).toEqual([
			'DELEGACIA DE ABAIARA',
			'DELEGACIA DE ÁGUAS BELAS',
			'DELEGACIA DO CRATO'
		]);
	});
});

describe('ordenarERecortar', () => {
	const itens = [
		{ nome: 'A', total: 10 },
		{ nome: 'B', total: 50 },
		{ nome: 'C', total: 30 }
	];
	const valor = (i: { total: number }) => i.total;

	it('melhores primeiro é o maior valor no topo', () => {
		const r = ordenarERecortar(itens, { ordem: 'melhores', quantidade: 'todas', valor });
		expect(r.map((i) => i.nome)).toEqual(['B', 'C', 'A']);
	});

	it('piores primeiro inverte', () => {
		const r = ordenarERecortar(itens, { ordem: 'piores', quantidade: 'todas', valor });
		expect(r.map((i) => i.nome)).toEqual(['A', 'C', 'B']);
	});

	it('"melhor" segue o valor informado, não o número cru', () => {
		// É este caso que justifica a ordem ser semântica: num indicador de REDUÇÃO,
		// quem ordena é o % de atingimento — a unidade com o menor acervo é a melhor.
		const unidades = [
			{ nome: 'CRATO', acervo: 900, atingimento: 90 },
			{ nome: 'BARBALHA', acervo: 400, atingimento: 20 }
		];
		const porAtingimento = ordenarERecortar(unidades, {
			ordem: 'melhores',
			quantidade: 'todas',
			valor: (u) => u.atingimento
		});
		expect(porAtingimento[0].nome).toBe('CRATO');
	});

	it('corta no Top-N', () => {
		const r = ordenarERecortar(itens, { ordem: 'melhores', quantidade: 5, valor });
		expect(r).toHaveLength(3); // menos itens que o corte: devolve o que há
		const dois = ordenarERecortar([...itens, { nome: 'D', total: 5 }], {
			ordem: 'piores',
			quantidade: 5,
			valor
		});
		expect(dois).toHaveLength(4);
	});

	it('não avaliável (null) vai para o FIM nos dois sentidos', () => {
		// Unidade sem linha de base não é a pior — é a que não se sabe. Pô-la no topo
		// de "piores primeiro" afirmaria o que o dado não diz.
		const comNulos = [
			{ nome: 'SEM BASE', v: null as number | null },
			{ nome: 'ALTA', v: 90 },
			{ nome: 'BAIXA', v: 10 }
		];
		const melhores = ordenarERecortar(comNulos, {
			ordem: 'melhores',
			quantidade: 'todas',
			valor: (i) => i.v
		});
		const piores = ordenarERecortar(comNulos, {
			ordem: 'piores',
			quantidade: 'todas',
			valor: (i) => i.v
		});
		expect(melhores.at(-1)?.nome).toBe('SEM BASE');
		expect(piores.at(-1)?.nome).toBe('SEM BASE');
	});

	it('empate preserva a ordem de entrada (alfabética)', () => {
		const empatados = [
			{ nome: 'ABAIARA', total: 7 },
			{ nome: 'BARBALHA', total: 7 },
			{ nome: 'CRATO', total: 7 }
		];
		const r = ordenarERecortar(empatados, { ordem: 'melhores', quantidade: 'todas', valor });
		expect(r.map((i) => i.nome)).toEqual(['ABAIARA', 'BARBALHA', 'CRATO']);
	});

	it('não muta a lista recebida', () => {
		const original = [...itens];
		ordenarERecortar(itens, { ordem: 'piores', quantidade: 'todas', valor });
		expect(itens).toEqual(original);
	});
});

describe('descreverRecorte', () => {
	it('descreve o eixo quando mostra tudo', () => {
		expect(descreverRecorte('seccionais', 'todas', 'melhores')).toBe('Todas as seccionais');
		expect(descreverRecorte('delegacias', 'todas', 'piores')).toBe('Todas as delegacias');
	});

	it('diz que é um recorte — o PNG exportado circula sozinho', () => {
		expect(descreverRecorte('delegacias', 5, 'piores')).toBe('Top 5 delegacias — piores primeiro');
		expect(descreverRecorte('seccionais', 10, 'melhores')).toBe(
			'Top 10 seccionais — melhores primeiro'
		);
	});
});
