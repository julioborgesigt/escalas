import { describe, it, expect } from 'vitest';
import { alertasDaViagem, DISTANCIA_MAXIMA_VEDACAO_RM_KM } from '../vedacoes';

/** Juazeiro do Norte → Crato: 12 km, os dois na Região Metropolitana do Cariri. */
const DENTRO_DO_CARIRI = {
	regiaoOrigem: 'RMC',
	regiaoDestino: 'RMC',
	distanciaKm: 12
} as const;

describe('alertasDaViagem — art. 4º, §1º, II', () => {
	it('alerta quando as TRÊS condições fecham', () => {
		expect(alertasDaViagem({ ...DENTRO_DO_CARIRI, extrapolacao: 'nao' })).toEqual([
			'mesma_regiao_metropolitana'
		]);
	});

	it('não alerta quando a jornada extrapolou — é a operação das 04h', () => {
		expect(alertasDaViagem({ ...DENTRO_DO_CARIRI, extrapolacao: 'horario_declarado' })).toEqual([]);
		expect(alertasDaViagem({ ...DENTRO_DO_CARIRI, extrapolacao: 'dia_pago' })).toEqual([]);
	});

	it('não alerta entre regiões diferentes', () => {
		expect(
			alertasDaViagem({
				regiaoOrigem: 'RMC',
				regiaoDestino: 'RMF',
				distanciaKm: 12,
				extrapolacao: 'nao'
			})
		).toEqual([]);
	});

	it('não alerta fora de região metropolitana — Iguatu não está em nenhuma', () => {
		expect(
			alertasDaViagem({
				regiaoOrigem: null,
				regiaoDestino: null,
				distanciaKm: 12,
				extrapolacao: 'nao'
			})
		).toEqual([]);
	});

	it('o raio de 120 km é inclusivo, e acima dele não alerta', () => {
		const base = { regiaoOrigem: 'RMF', regiaoDestino: 'RMF', extrapolacao: 'nao' } as const;
		expect(alertasDaViagem({ ...base, distanciaKm: DISTANCIA_MAXIMA_VEDACAO_RM_KM })).toEqual([
			'mesma_regiao_metropolitana'
		]);
		expect(alertasDaViagem({ ...base, distanciaKm: DISTANCIA_MAXIMA_VEDACAO_RM_KM + 1 })).toEqual(
			[]
		);
	});

	it('sem distância medida NÃO alerta — alerta por desconhecimento vira ruído', () => {
		expect(
			alertasDaViagem({ ...DENTRO_DO_CARIRI, distanciaKm: null, extrapolacao: 'nao' })
		).toEqual([]);
	});
});

describe('alertasDaViagem — demais vedações', () => {
	it('acusa origem e destino no mesmo município', () => {
		expect(alertasDaViagem({ mesmaCidade: true, extrapolacao: 'dia_pago' })).toEqual([
			'sem_afastamento_da_sede'
		]);
	});

	it('acusa o estouro do teto mensal', () => {
		expect(alertasDaViagem({ extrapolacao: 'dia_pago', mesesAcimaDoTeto: ['2026-09'] })).toEqual([
			'teto_mensal'
		]);
	});

	it('lista vazia de meses não é alerta', () => {
		expect(alertasDaViagem({ extrapolacao: 'dia_pago', mesesAcimaDoTeto: [] })).toEqual([]);
	});

	it('acumula em ordem estável', () => {
		expect(
			alertasDaViagem({
				...DENTRO_DO_CARIRI,
				extrapolacao: 'nao',
				mesmaCidade: true,
				mesesAcimaDoTeto: ['2026-09']
			})
		).toEqual(['mesma_regiao_metropolitana', 'sem_afastamento_da_sede', 'teto_mensal']);
	});

	it('viagem comum não gera alerta nenhum', () => {
		expect(
			alertasDaViagem({
				regiaoOrigem: null,
				regiaoDestino: 'RMC',
				distanciaKm: 154,
				extrapolacao: 'horario_declarado'
			})
		).toEqual([]);
	});
});
