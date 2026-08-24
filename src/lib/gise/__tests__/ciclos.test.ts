import { describe, expect, it } from 'vitest';
import { anosParaSeletorCiclo, cicloQueContem, getCicloRange } from '../ciclos';

describe('getCicloRange', () => {
	it('ciclo 1 atravessa o ano (21/dez a 20/jan)', () => {
		expect(getCicloRange(2026, 1)).toEqual({ inicio: '2025-12-21', fim: '2026-01-20' });
	});

	it('ciclo 7 é 21/jun a 20/jul', () => {
		expect(getCicloRange(2026, 7)).toEqual({ inicio: '2026-06-21', fim: '2026-07-20' });
	});
});

describe('cicloQueContem', () => {
	it('dia 21 em diante entra no ciclo do mês seguinte', () => {
		expect(cicloQueContem('2026-08-21')).toEqual({ ano: 2026, ciclo: 9 });
		expect(cicloQueContem('2026-08-22')).toEqual({ ano: 2026, ciclo: 9 });
	});

	it('dia 20 ou antes fica no ciclo que termina naquele mês', () => {
		expect(cicloQueContem('2026-08-20')).toEqual({ ano: 2026, ciclo: 8 });
		expect(cicloQueContem('2026-01-10')).toEqual({ ano: 2026, ciclo: 1 });
	});

	it('21/dez abre o ciclo 1 do ano seguinte', () => {
		expect(cicloQueContem('2026-12-21')).toEqual({ ano: 2027, ciclo: 1 });
		expect(cicloQueContem('2026-12-20')).toEqual({ ano: 2026, ciclo: 12 });
	});
});

describe('anosParaSeletorCiclo', () => {
	it('oferece dois anos para trás e um à frente do ciclo corrente', () => {
		expect(anosParaSeletorCiclo('2026-08-22')).toEqual([2024, 2025, 2026, 2027]);
	});
});
