/**
 * Testes do failsafe do cron de limpeza de retenção (LGPD). Cobrem a lógica
 * pura `avaliarSaudeLimpeza` — a parte de I/O (`verificarSaudeLimpezaRetencao`)
 * é um wrapper fino sobre uma única consulta indexada.
 */
import { describe, it, expect } from 'vitest';
import { avaliarSaudeLimpeza } from '../lgpd-retencao';

// Instante de referência fixo (UTC) para tornar os testes determinísticos.
const AGORA = Date.parse('2026-06-13T12:00:00Z');

describe('avaliarSaudeLimpeza', () => {
	it('marca como atrasada quando nunca executou (null)', () => {
		const r = avaliarSaudeLimpeza(null, 48, AGORA);
		expect(r).toEqual({ ultimaExecucao: null, horasDesdeUltima: null, atrasada: true });
	});

	it('não está atrasada quando dentro da tolerância', () => {
		// 24h atrás, tolerância 48h
		const r = avaliarSaudeLimpeza('2026-06-12 12:00:00', 48, AGORA);
		expect(r.atrasada).toBe(false);
		expect(r.horasDesdeUltima).toBeCloseTo(24, 5);
	});

	it('está atrasada quando ultrapassa a tolerância', () => {
		// 72h atrás, tolerância 48h
		const r = avaliarSaudeLimpeza('2026-06-10 12:00:00', 48, AGORA);
		expect(r.atrasada).toBe(true);
		expect(r.horasDesdeUltima).toBeCloseTo(72, 5);
	});

	it('trata o formato sem fuso do SQLite como UTC', () => {
		const semFuso = avaliarSaudeLimpeza('2026-06-13 06:00:00', 48, AGORA);
		const comFuso = avaliarSaudeLimpeza('2026-06-13T06:00:00Z', 48, AGORA);
		expect(semFuso.horasDesdeUltima).toBeCloseTo(6, 5);
		expect(semFuso.horasDesdeUltima).toBe(comFuso.horasDesdeUltima);
	});

	it('marca como atrasada quando o timestamp é inválido', () => {
		const r = avaliarSaudeLimpeza('data-invalida', 48, AGORA);
		expect(r.horasDesdeUltima).toBeNull();
		expect(r.atrasada).toBe(true);
	});

	it('exatamente na tolerância ainda não é considerado atrasado', () => {
		// 48h atrás, tolerância 48h → 48 > 48 é falso
		const r = avaliarSaudeLimpeza('2026-06-11 12:00:00', 48, AGORA);
		expect(r.horasDesdeUltima).toBeCloseTo(48, 5);
		expect(r.atrasada).toBe(false);
	});
});
