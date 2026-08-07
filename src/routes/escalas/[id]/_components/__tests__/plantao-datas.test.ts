import { describe, it, expect } from 'vitest';
import { calcularDatasPlantao } from '../plantao-datas';

describe('calcularDatasPlantao', () => {
	const escala = { data_inicio: '2026-03-01', data_fim: '2026-03-31' };

	it('1x3: passo de 4 dias dentro do mês', () => {
		expect(calcularDatasPlantao(escala, '2026-03-01', '1x3')).toEqual([
			'2026-03-01',
			'2026-03-05',
			'2026-03-09',
			'2026-03-13',
			'2026-03-17',
			'2026-03-21',
			'2026-03-25',
			'2026-03-29'
		]);
	});

	it('2x6: dois dias seguidos e passo 8', () => {
		expect(calcularDatasPlantao(escala, '2026-03-01', '2x6')).toEqual([
			'2026-03-01',
			'2026-03-02',
			'2026-03-09',
			'2026-03-10',
			'2026-03-17',
			'2026-03-18',
			'2026-03-25',
			'2026-03-26'
		]);
	});

	it('ignora dias antes de data_inicio', () => {
		expect(calcularDatasPlantao(escala, '2026-02-27', '1x3')).toEqual([
			'2026-03-03',
			'2026-03-07',
			'2026-03-11',
			'2026-03-15',
			'2026-03-19',
			'2026-03-23',
			'2026-03-27',
			'2026-03-31'
		]);
	});

	it('não cruza data_fim', () => {
		expect(calcularDatasPlantao(escala, '2026-03-30', '1x3')).toEqual(['2026-03-30']);
	});

	it('primeiro plantão vazio → []', () => {
		expect(calcularDatasPlantao(escala, '', '1x3')).toEqual([]);
	});
});
