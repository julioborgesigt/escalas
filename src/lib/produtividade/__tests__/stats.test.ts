import { describe, it, expect } from 'vitest';
import { calculateRanking } from '../stats';
import { chaveDoGrupo } from '../agrupamento';

/**
 * `calculateRanking` deixou de ser "por seccional" e passou a receber os grupos
 * e a chave de fora, para atender aos dois eixos do painel. O que estes testes
 * fixam é o contrato dessa generalização — e a regra que já valia antes dela:
 * grupo sem resposta nenhuma aparece com total 0, porque "não produziu" é
 * informação, não ausência de dado.
 */

/** 2ª Seccional (id 1) com Crato (10) e Barbalha (20); 1ª Seccional (2) sem nada. */
const LINHAS = [
	{ seccional_id: 1, unidade_id: 10, respostasParsed: { presos: 3 } },
	{ seccional_id: 1, unidade_id: 10, respostasParsed: { presos: 2 } },
	{ seccional_id: 1, unidade_id: 20, respostasParsed: { presos: 7 } }
];

const presos = (res: Record<string, unknown>) => Number(res.presos) || 0;

describe('calculateRanking', () => {
	it('soma por seccional quando a chave é a de seccional', () => {
		const r = calculateRanking(
			[
				{ id: 1, nome: '2ª SECCIONAL' },
				{ id: 2, nome: '1ª SECCIONAL' }
			],
			LINHAS,
			presos,
			chaveDoGrupo('seccionais')
		);
		expect(r.find((i) => i.nome === '2ª SECCIONAL')?.total).toBe(12);
	});

	it('soma por delegacia quando a chave é a de unidade — a MESMA lista', () => {
		// O total não muda ao trocar de eixo (12), só a quebra: é isso que torna
		// legítimo alternar os dois modos sobre os mesmos dados.
		const r = calculateRanking(
			[
				{ id: 10, nome: 'DELEGACIA DO CRATO' },
				{ id: 20, nome: 'DELEGACIA DE BARBALHA' }
			],
			LINHAS,
			presos,
			chaveDoGrupo('delegacias')
		);
		expect(r.find((i) => i.nome === 'DELEGACIA DO CRATO')?.total).toBe(5);
		expect(r.find((i) => i.nome === 'DELEGACIA DE BARBALHA')?.total).toBe(7);
		expect(r.reduce((a, i) => a + i.total, 0)).toBe(12);
	});

	it('grupo sem nenhuma resposta aparece com total 0', () => {
		const r = calculateRanking(
			[
				{ id: 1, nome: '2ª SECCIONAL' },
				{ id: 2, nome: '1ª SECCIONAL' }
			],
			LINHAS,
			presos,
			chaveDoGrupo('seccionais')
		);
		expect(r.find((i) => i.nome === '1ª SECCIONAL')?.total).toBe(0);
	});

	it('linha de um grupo fora da lista é ignorada, não derruba a soma', () => {
		// Acontece no modo delegacias quando o Top-N já recortou os grupos.
		const r = calculateRanking(
			[{ id: 10, nome: 'CRATO' }],
			LINHAS,
			presos,
			chaveDoGrupo('delegacias')
		);
		expect(r).toHaveLength(1);
		expect(r[0].total).toBe(5);
	});

	it('linha sem a chave do modo não entra', () => {
		const semUnidade = [{ seccional_id: 1, respostasParsed: { presos: 99 } }];
		const r = calculateRanking(
			[{ id: 10, nome: 'CRATO' }],
			semUnidade,
			presos,
			chaveDoGrupo('delegacias')
		);
		expect(r[0].total).toBe(0);
	});

	it('NÃO ordena — a ordem é decisão da tela', () => {
		// Ordenar aqui daria uma ordem que `ordenarERecortar` teria de desfazer para
		// atender "piores primeiro".
		const r = calculateRanking(
			[
				{ id: 20, nome: 'BARBALHA' },
				{ id: 10, nome: 'CRATO' }
			],
			LINHAS,
			presos,
			chaveDoGrupo('delegacias')
		);
		expect(r.map((i) => i.nome)).toEqual(['BARBALHA', 'CRATO']);
	});

	it('carrega o rótulo curto para a tela', () => {
		const r = calculateRanking(
			[{ id: 10, nome: 'DELEGACIA DO CRATO', curto: 'CRATO' }],
			LINHAS,
			presos,
			chaveDoGrupo('delegacias')
		);
		expect(r[0].curto).toBe('CRATO');
	});

	it('parseia o blob cru quando não veio pré-parseado', () => {
		const crus = [{ seccional_id: 1, respostas: '{"presos":4}' }];
		const r = calculateRanking([{ id: 1, nome: 'SEC' }], crus, presos, chaveDoGrupo('seccionais'));
		expect(r[0].total).toBe(4);
	});
});
