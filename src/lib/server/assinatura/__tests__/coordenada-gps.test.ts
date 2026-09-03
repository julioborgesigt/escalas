import { describe, it, expect } from 'vitest';
import { coordenadaGeograficaValida, reduzirPrecisaoGps } from '../document-utils';

/** Iguatu/CE — a coordenada real de uma operação GISE. */
const LAT = -6.3597;
const LON = -39.2986;

describe('coordenadaGeograficaValida', () => {
	it('aceita coordenada real', () => {
		expect(coordenadaGeograficaValida(LAT, LON)).toBe(true);
	});

	it('RECUSA NaN — o furo: `typeof NaN === "number"` passava pelo gate antigo', () => {
		// É exatamente o que `parseFloat('abc')` devolve no servidor.
		expect(typeof NaN).toBe('number');
		expect(coordenadaGeograficaValida(NaN, NaN)).toBe(false);
		expect(coordenadaGeograficaValida(Number.parseFloat('abc'), LON)).toBe(false);
		expect(coordenadaGeograficaValida(LAT, Number.parseFloat(''))).toBe(false);
	});

	it('recusa Infinity', () => {
		expect(coordenadaGeograficaValida(Infinity, LON)).toBe(false);
		expect(coordenadaGeograficaValida(LAT, -Infinity)).toBe(false);
	});

	it('recusa fora de faixa — a coordenada impossível era IMPRESSA como local do ato', () => {
		expect(coordenadaGeograficaValida(999, LON)).toBe(false);
		expect(coordenadaGeograficaValida(LAT, -5000)).toBe(false);
		expect(coordenadaGeograficaValida(90.1, 0)).toBe(false);
		expect(coordenadaGeograficaValida(0, 180.1)).toBe(false);
	});

	it('aceita os extremos válidos e o zero (equador / Greenwich)', () => {
		expect(coordenadaGeograficaValida(90, 180)).toBe(true);
		expect(coordenadaGeograficaValida(-90, -180)).toBe(true);
		expect(coordenadaGeograficaValida(0, 0)).toBe(true);
	});

	it('recusa não-número (string do FormData sem parse, null, undefined)', () => {
		expect(coordenadaGeograficaValida('-6.35', '-39.29')).toBe(false);
		expect(coordenadaGeograficaValida(null, null)).toBe(false);
		expect(coordenadaGeograficaValida(undefined, undefined)).toBe(false);
		expect(coordenadaGeograficaValida(LAT, undefined)).toBe(false);
	});
});

describe('reduzirPrecisaoGps', () => {
	it('reduz a ~1 km (2 casas), que é a minimização LGPD', () => {
		expect(reduzirPrecisaoGps(LAT)).toBe(-6.36);
		expect(reduzirPrecisaoGps(LON)).toBe(-39.3);
	});

	it('ausência continua ausência', () => {
		expect(reduzirPrecisaoGps(undefined)).toBeUndefined();
	});

	it('não-finito vira undefined em vez de NaN arredondado', () => {
		// `Math.round(NaN)` é `NaN`, e NaN numa coluna REAL do SQLite chega como
		// NULL: "sem GPS" por acidente, sem nada no caminho dizendo isso.
		expect(reduzirPrecisaoGps(NaN)).toBeUndefined();
		expect(reduzirPrecisaoGps(Infinity)).toBeUndefined();
	});
});
