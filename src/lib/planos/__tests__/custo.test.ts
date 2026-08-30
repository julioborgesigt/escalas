/**
 * O cálculo do dinheiro. Dois pontos concentram o risco e por isso têm bateria
 * própria: a **classe em branco**, que não pode virar R$ 0 em silêncio, e o
 * **arredondamento da meia diária**, onde um float mal colocado produz o
 * centavo de diferença que faz o documento voltar.
 */
import { describe, it, expect } from 'vitest';
import {
	custoDaEquipe,
	custoDoPlano,
	custoDeDiarias,
	podeEmitir,
	type ValoresCusto,
	type EquipeParaCusto,
	type MembroParaCusto
} from '../custo';

/** Valores redondos para a conta ser conferível de cabeça. */
const VALORES: ValoresCusto = {
	oip_cd_normal: 2730, // R$ 27,30
	oip_ab_normal: 3413,
	dpc_12_normal: 5000,
	dpc_3e_normal: 6000,
	oip_cd_plus: 3549, // 2730 × 1,3
	oip_ab_plus: 4437,
	dpc_12_plus: 6500,
	dpc_3e_plus: 7800,
	diaria_estadual: 35000, // R$ 350,00
	diaria_interestadual: 60000
};

function membro(over: Partial<MembroParaCusto> = {}): MembroParaCusto {
	return {
		id: 1,
		policial_id: 1,
		nome: 'FULANO DE TAL',
		cargo_snapshot: 'OIP',
		classe_snapshot: 'C',
		...over
	};
}

function equipe(over: Partial<EquipeParaCusto> = {}): EquipeParaCusto {
	return {
		id: 1,
		nome: 'Equipe 01',
		tipo_custo: 'hora_extra',
		horas_normais: 5,
		horas_plus: 1,
		diaria_tipo: null,
		diarias_meias: 0,
		...over
	};
}

describe('custoDaEquipe — hora extra', () => {
	it('soma normais e plus pela faixa do servidor', () => {
		// OIP classe C: 5 × 2730 + 1 × 3549 = 13650 + 3549 = 17199
		const r = custoDaEquipe(equipe(), [membro()], VALORES);
		expect(r.total).toBe(17199);
		expect(r.membros[0].categoria).toBe('oip');
	});

	it('faixas diferentes na mesma equipe custam diferente', () => {
		const r = custoDaEquipe(
			equipe({ horas_normais: 6, horas_plus: 0 }),
			[
				membro({ id: 1, policial_id: 1, cargo_snapshot: 'OIP', classe_snapshot: 'C' }),
				membro({ id: 2, policial_id: 2, cargo_snapshot: 'OIP', classe_snapshot: 'A' }),
				membro({ id: 3, policial_id: 3, cargo_snapshot: 'DPC', classe_snapshot: '1ª' })
			],
			VALORES
		);
		expect(r.membros.map((m) => m.total)).toEqual([6 * 2730, 6 * 3413, 6 * 5000]);
		expect(r.total).toBe(6 * (2730 + 3413 + 5000));
	});

	it('DPC e OIP caem em categorias diferentes do Anexo II', () => {
		const r = custoDaEquipe(
			equipe(),
			[
				membro({ id: 1, policial_id: 1, cargo_snapshot: 'DPC', classe_snapshot: 'ESPECIAL' }),
				membro({ id: 2, policial_id: 2, cargo_snapshot: 'OIP', classe_snapshot: 'D' })
			],
			VALORES
		);
		expect(r.membros.map((m) => m.categoria)).toEqual(['dpc', 'oip']);
	});
});

describe('custoDaEquipe — sem custo', () => {
	it('não cobra nada, mesmo com horas preenchidas', () => {
		const r = custoDaEquipe(
			equipe({ tipo_custo: 'sem_custo', horas_normais: 10, horas_plus: 4 }),
			[membro()],
			VALORES
		);
		expect(r.total).toBe(0);
	});

	it('servidor sem classe numa equipe sem custo NÃO é pendência', () => {
		// O caso mais comum de todos: operação diurna em dia útil. Travar a emissão
		// por classe faltando aqui bloquearia um plano que não custa nada.
		const r = custoDoPlano(
			[
				{
					equipe: equipe({ tipo_custo: 'sem_custo' }),
					membros: [membro({ classe_snapshot: '' })]
				}
			],
			VALORES
		);
		expect(r.pendencias).toEqual([]);
		expect(podeEmitir(r)).toBe(true);
	});
});

describe('custoDeDiarias — o arredondamento', () => {
	it('meia diária é metade, diária inteira é o valor cheio', () => {
		expect(custoDeDiarias(1, 35000)).toBe(17500);
		expect(custoDeDiarias(2, 35000)).toBe(35000);
		expect(custoDeDiarias(3, 35000)).toBe(52500);
		expect(custoDeDiarias(30, 35000)).toBe(525000);
	});

	it('valor ímpar em centavos arredonda meio-para-cima, sem perder precisão no meio', () => {
		// 1 meia × 35001 / 2 = 17500,5 → 17501
		expect(custoDeDiarias(1, 35001)).toBe(17501);
		// 3 meias × 35001 / 2 = 52501,5 → 52502
		expect(custoDeDiarias(3, 35001)).toBe(52502);
		// A multiplicação vem ANTES da divisão: 5 × 35001 = 175005, /2 = 87502,5 → 87503.
		// Dividir primeiro (17500,5 × 5) daria 87502,5 também, mas por float.
		expect(custoDeDiarias(5, 35001)).toBe(87503);
	});

	it('o total de diárias é sempre inteiro em centavos', () => {
		for (let meias = 1; meias <= 30; meias++) {
			for (const valor of [35000, 35001, 60000, 12345, 99999]) {
				expect(Number.isInteger(custoDeDiarias(meias, valor))).toBe(true);
			}
		}
	});
});

describe('custoDaEquipe — diárias', () => {
	it('cobra por servidor, no tipo escolhido', () => {
		const r = custoDaEquipe(
			equipe({ tipo_custo: 'diaria', diaria_tipo: 'estadual', diarias_meias: 3 }),
			[membro({ id: 1, policial_id: 1 }), membro({ id: 2, policial_id: 2 })],
			VALORES
		);
		expect(r.membros.map((m) => m.total)).toEqual([52500, 52500]);
		expect(r.total).toBe(105000);
	});

	it('interestadual usa o outro valor', () => {
		const r = custoDaEquipe(
			equipe({ tipo_custo: 'diaria', diaria_tipo: 'interestadual', diarias_meias: 2 }),
			[membro()],
			VALORES
		);
		expect(r.total).toBe(60000);
	});

	it('a diária não muda com a classe, mas a CATEGORIA do Anexo II muda', () => {
		const r = custoDaEquipe(
			equipe({ tipo_custo: 'diaria', diaria_tipo: 'estadual', diarias_meias: 2 }),
			[
				membro({ id: 1, policial_id: 1, cargo_snapshot: 'DPC', classe_snapshot: '3ª' }),
				membro({ id: 2, policial_id: 2, cargo_snapshot: 'OIP', classe_snapshot: 'D' })
			],
			VALORES
		);
		expect(r.membros.map((m) => m.total)).toEqual([35000, 35000]);
		expect(r.membros.map((m) => m.categoria)).toEqual(['dpc', 'oip']);
	});
});

describe('classe não resolvida bloqueia a emissão', () => {
	it('servidor sem classe entra em pendências e NÃO soma', () => {
		const r = custoDoPlano(
			[
				{
					equipe: equipe(),
					membros: [
						membro({ id: 1, policial_id: 1, classe_snapshot: 'C' }),
						membro({ id: 2, policial_id: 2, nome: 'SEM CLASSE', classe_snapshot: '' })
					]
				}
			],
			VALORES
		);
		expect(r.total).toBe(17199); // só o primeiro
		expect(r.pendencias).toHaveLength(1);
		expect(r.pendencias[0]).toMatchObject({
			policial_id: 2,
			nome: 'SEM CLASSE',
			equipe: 'Equipe 01',
			motivo: 'Servidor sem classe cadastrada'
		});
		expect(podeEmitir(r)).toBe(false);
	});

	it('classe que não corresponde ao cargo também bloqueia, e o motivo diz por quê', () => {
		// "1ª" é classe de DPC; num OIP não resolve faixa nenhuma.
		const r = custoDoPlano(
			[{ equipe: equipe(), membros: [membro({ cargo_snapshot: 'OIP', classe_snapshot: '1ª' })] }],
			VALORES
		);
		expect(r.pendencias[0].motivo).toMatch(/Classe "1ª" não corresponde ao cargo OIP/);
		expect(podeEmitir(r)).toBe(false);
	});

	it('a pendência aponta a EQUIPE, para o admin saber onde corrigir', () => {
		const r = custoDoPlano(
			[
				{ equipe: equipe({ id: 1, nome: 'Equipe 01' }), membros: [membro()] },
				{
					equipe: equipe({ id: 2, nome: 'Equipe 02' }),
					membros: [membro({ id: 9, policial_id: 9, classe_snapshot: '' })]
				}
			],
			VALORES
		);
		expect(r.pendencias).toHaveLength(1);
		expect(r.pendencias[0].equipe).toBe('Equipe 02');
	});
});

describe('consolidado do Anexo II', () => {
	it('reproduz o modelo: dois OIPs, 6h (5N/1A), só DRO', () => {
		// O plano-modelo tem duas equipes de um OIP cada, 6h (5N/1A).
		const r = custoDoPlano(
			[
				{
					equipe: equipe({ id: 1, nome: 'Equipe 01' }),
					membros: [membro({ id: 1, policial_id: 1, classe_snapshot: 'C' })]
				},
				{
					equipe: equipe({ id: 2, nome: 'Equipe 02' }),
					membros: [membro({ id: 2, policial_id: 2, classe_snapshot: 'A' })]
				}
			],
			VALORES
		);

		expect(r.consolidado.dro).toEqual([
			{ categoria: 'oip', quantidade: 2, total: 17199 + (5 * 3413 + 4437) }
		]);
		expect(r.consolidado.diarias).toEqual([]);
		expect(r.consolidado.totalGeral).toBe(r.total);
	});

	it('separa DRO de diárias e soma os dois no total geral', () => {
		const r = custoDoPlano(
			[
				{
					equipe: equipe({ id: 1, nome: 'E1', tipo_custo: 'hora_extra' }),
					membros: [membro({ id: 1, policial_id: 1 })]
				},
				{
					equipe: equipe({
						id: 2,
						nome: 'E2',
						tipo_custo: 'diaria',
						diaria_tipo: 'estadual',
						diarias_meias: 2
					}),
					membros: [membro({ id: 2, policial_id: 2 })]
				}
			],
			VALORES
		);
		expect(r.consolidado.droTotal).toBe(17199);
		expect(r.consolidado.diariasTotal).toBe(35000);
		expect(r.consolidado.totalGeral).toBe(52199);
	});

	it('Delegados vêm antes de Agentes, como no modelo', () => {
		const r = custoDoPlano(
			[
				{
					equipe: equipe(),
					membros: [
						membro({ id: 1, policial_id: 1, cargo_snapshot: 'OIP', classe_snapshot: 'C' }),
						membro({ id: 2, policial_id: 2, cargo_snapshot: 'DPC', classe_snapshot: '1ª' })
					]
				}
			],
			VALORES
		);
		expect(r.consolidado.dro.map((l) => l.categoria)).toEqual(['dpc', 'oip']);
	});

	it('QUANTIDADE conta servidores, não equipes', () => {
		const r = custoDoPlano(
			[
				{
					equipe: equipe({ id: 1, nome: 'E1' }),
					membros: [membro({ id: 1, policial_id: 1 }), membro({ id: 2, policial_id: 2 })]
				},
				{ equipe: equipe({ id: 2, nome: 'E2' }), membros: [membro({ id: 3, policial_id: 3 })] }
			],
			VALORES
		);
		expect(r.consolidado.dro[0].quantidade).toBe(3);
	});

	it('equipe sem custo não aparece em nenhum bloco do Anexo II', () => {
		const r = custoDoPlano(
			[{ equipe: equipe({ tipo_custo: 'sem_custo' }), membros: [membro()] }],
			VALORES
		);
		expect(r.consolidado.dro).toEqual([]);
		expect(r.consolidado.diarias).toEqual([]);
		expect(r.consolidado.totalGeral).toBe(0);
	});

	it('plano vazio é zero, e emitível', () => {
		const r = custoDoPlano([], VALORES);
		expect(r.total).toBe(0);
		expect(podeEmitir(r)).toBe(true);
	});
});
