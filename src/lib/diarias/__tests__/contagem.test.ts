import { describe, it, expect } from 'vitest';
import {
	diasDoAfastamento,
	meiasPorMes,
	totalDeMeias,
	mesesAcimaDoTeto,
	MAX_MEIAS_MES
} from '../contagem';

describe('diasDoAfastamento', () => {
	it('conta início e fim (um dia é 1, não 0)', () => {
		expect(diasDoAfastamento('2026-09-10', '2026-09-10')).toBe(1);
		expect(diasDoAfastamento('2026-09-10', '2026-09-11')).toBe(2);
	});

	it('atravessa a virada do mês e a do ano', () => {
		expect(diasDoAfastamento('2026-09-28', '2026-10-03')).toBe(6);
		expect(diasDoAfastamento('2026-12-30', '2027-01-02')).toBe(4);
	});

	it('devolve null quando o período não é utilizável', () => {
		expect(diasDoAfastamento('2026-09-11', '2026-09-10')).toBeNull(); // invertido
		expect(diasDoAfastamento('', '2026-09-10')).toBeNull();
		expect(diasDoAfastamento('2026-09-10', '10/09/2026')).toBeNull();
		expect(diasDoAfastamento('2026-09-10', '2226-09-10')).toBeNull(); // acima do teto do laço
	});
});

describe('totalDeMeias', () => {
	// Os números do texto normativo, que é o que este teste está protegendo:
	// "2 dias = 1,5 diárias; 7 dias = 6,5; 10 dias = 9,5".
	it('reproduz os exemplos do decreto', () => {
		expect(totalDeMeias('2026-09-10', '2026-09-11')).toBe(3); // 1,5
		expect(totalDeMeias('2026-09-10', '2026-09-16')).toBe(13); // 6,5
		expect(totalDeMeias('2026-09-10', '2026-09-19')).toBe(19); // 9,5
	});

	it('a missão de um dia vale meia diária', () => {
		expect(totalDeMeias('2026-09-10', '2026-09-10')).toBe(1);
	});

	it('é sempre 2N − 1', () => {
		for (let n = 1; n <= 20; n++) {
			const fim = new Date(Date.UTC(2026, 8, 9 + n)).toISOString().slice(0, 10);
			expect(totalDeMeias('2026-09-10', fim)).toBe(2 * n - 1);
		}
	});

	it('é zero quando o período não é utilizável', () => {
		expect(totalDeMeias('2026-09-11', '2026-09-10')).toBe(0);
	});
});

describe('meiasPorMes', () => {
	it('reparte a missão que atravessa o mês pela data de cada diária', () => {
		// 28, 29 e 30 de setembro valem 2 meias cada; 1 e 2 de outubro idem; o
		// dia 3, último, vale 1. Setembro fica com 3 diárias e outubro com 2,5.
		const porMes = meiasPorMes('2026-09-28', '2026-10-03');
		expect(porMes.get('2026-09')).toBe(6);
		expect(porMes.get('2026-10')).toBe(5);
	});

	it('soma exatamente o total — as duas contas não podem divergir', () => {
		const soma = [...meiasPorMes('2026-09-28', '2026-10-03').values()].reduce((a, b) => a + b, 0);
		expect(soma).toBe(totalDeMeias('2026-09-28', '2026-10-03'));
	});

	it('a missão de um dia lança meia diária no mês dela', () => {
		expect([...meiasPorMes('2026-09-10', '2026-09-10')]).toEqual([['2026-09', 1]]);
	});

	it('devolve mapa vazio quando o período não é utilizável', () => {
		expect(meiasPorMes('2026-09-11', '2026-09-10').size).toBe(0);
	});
});

describe('mesesAcimaDoTeto', () => {
	it('nada estoura quando o servidor está zerado', () => {
		expect(mesesAcimaDoTeto('2026-09-10', '2026-09-11', new Map())).toEqual([]);
	});

	it('o teto é 15 diárias, e a igualdade ainda cabe', () => {
		// 29 meias lançadas + 1 desta missão = 30 = exatamente 15 diárias.
		const cheio = new Map([['2026-09', MAX_MEIAS_MES - 1]]);
		expect(mesesAcimaDoTeto('2026-09-10', '2026-09-10', cheio)).toEqual([]);
	});

	it('acusa o mês que passa de 15 diárias', () => {
		const cheio = new Map([['2026-09', MAX_MEIAS_MES]]);
		expect(mesesAcimaDoTeto('2026-09-10', '2026-09-10', cheio)).toEqual(['2026-09']);
	});

	it('acusa só o mês que estoura, não a missão inteira', () => {
		// Outubro tem folga; setembro não.
		const cheio = new Map([['2026-09', MAX_MEIAS_MES - 1]]);
		expect(mesesAcimaDoTeto('2026-09-28', '2026-10-03', cheio)).toEqual(['2026-09']);
	});
});
