import { describe, it, expect } from 'vitest';
import { sugerirCusteio, DISTANCIA_MINIMA_DIARIA_KM } from '../custeio';
import type { HorasClassificadas } from '../horas-extras';

/** Janela que gera hora extra — usada quando o teste é sobre a distância. */
const COM_HORAS: HorasClassificadas = { normais: 5, plus: 1, semCusto: 0 };
/** Janela inteiramente dentro do expediente: nenhuma hora paga. */
const EXPEDIENTE: HorasClassificadas = { normais: 0, plus: 0, semCusto: 8 };

describe('sugerirCusteio', () => {
	describe('a distância decide antes do relógio', () => {
		it('100 km exatos já são diária — o limite é INCLUSIVO', () => {
			const r = sugerirCusteio({ distanciaKm: DISTANCIA_MINIMA_DIARIA_KM, horas: COM_HORAS });
			expect(r.tipo_custo).toBe('diaria');
			expect(r.motivo).toBe('distancia');
		});

		it('99 km ainda é hora extra', () => {
			const r = sugerirCusteio({ distanciaKm: 99, horas: COM_HORAS });
			expect(r.tipo_custo).toBe('hora_extra');
			expect(r.motivo).toBe('horario');
		});

		/**
		 * O caso que inverte o resultado conforme a ordem das perguntas — e a razão
		 * de a distância vir primeiro. Terça às 09:00 não gera hora nenhuma; pelo
		 * relógio esta equipe custaria ZERO, tendo dormido fora.
		 */
		it('deslocamento longo em pleno expediente é diária, não "sem custo"', () => {
			const r = sugerirCusteio({ distanciaKm: 180, horas: EXPEDIENTE });
			expect(r.tipo_custo).toBe('diaria');
			expect(r.motivo).toBe('distancia');
		});

		it('zera as horas ao propor diária — as duas rubricas não se somam', () => {
			const r = sugerirCusteio({ distanciaKm: 250, horas: COM_HORAS });
			expect(r.horas).toEqual({ normais: 0, plus: 0, semCusto: 0 });
		});
	});

	describe('abaixo do limite, vale a janela', () => {
		it('janela com horas → hora extra, copiando as horas classificadas', () => {
			const r = sugerirCusteio({ distanciaKm: 40, horas: COM_HORAS });
			expect(r.tipo_custo).toBe('hora_extra');
			expect(r.horas).toEqual(COM_HORAS);
		});

		it('janela dentro do expediente → sem custo, não "hora extra de zero horas"', () => {
			const r = sugerirCusteio({ distanciaKm: 40, horas: EXPEDIENTE });
			expect(r.tipo_custo).toBe('sem_custo');
			expect(r.motivo).toBe('horario');
		});

		it('zero km é uma MEDIDA (mesma cidade), não ausência de medida', () => {
			const r = sugerirCusteio({ distanciaKm: 0, horas: COM_HORAS });
			expect(r.tipo_custo).toBe('hora_extra');
			expect(r.motivo).toBe('horario');
		});
	});

	describe('distância ausente é distinguível de distância curta', () => {
		/**
		 * A distinção existe para a TELA poder avisar. Sem ela, uma equipe que
		 * ninguém mediu receberia "hora extra" com a mesma confiança de uma medida
		 * em 40 km — e a diária não sugerida é a que não é paga.
		 */
		it('null decide pela janela, mas marca o motivo como sem_distancia', () => {
			const r = sugerirCusteio({ distanciaKm: null, horas: COM_HORAS });
			expect(r.tipo_custo).toBe('hora_extra');
			expect(r.motivo).toBe('sem_distancia');
		});

		it('null com janela de expediente → sem custo, ainda marcado como sem_distancia', () => {
			const r = sugerirCusteio({ distanciaKm: null, horas: EXPEDIENTE });
			expect(r.tipo_custo).toBe('sem_custo');
			expect(r.motivo).toBe('sem_distancia');
		});

		it('entrada quebrada (negativa ou NaN) é tratada como não medida', () => {
			expect(sugerirCusteio({ distanciaKm: -5, horas: COM_HORAS }).motivo).toBe('sem_distancia');
			expect(sugerirCusteio({ distanciaKm: Number.NaN, horas: COM_HORAS }).motivo).toBe(
				'sem_distancia'
			);
			// E, sobretudo, nunca vira diária por comparação com lixo.
			expect(sugerirCusteio({ distanciaKm: Number.NaN, horas: COM_HORAS }).tipo_custo).toBe(
				'hora_extra'
			);
		});
	});
});
