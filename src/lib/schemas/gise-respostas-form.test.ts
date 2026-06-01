import { describe, it, expect } from 'vitest';
import {
	parseRespostasFormularioJsonLoose,
	parseRespostasFormularioJsonStrict
} from './gise-respostas-form';

describe('parseRespostasFormularioJsonLoose', () => {
	it('objeto válido', () => {
		expect(parseRespostasFormularioJsonLoose('{"a":1}')).toEqual({ a: 1 });
	});
	it('JSON inválido vira {}', () => {
		expect(parseRespostasFormularioJsonLoose('{')).toEqual({});
	});
	it('array vira {}', () => {
		expect(parseRespostasFormularioJsonLoose('[1,2]')).toEqual({});
	});
});

describe('parseRespostasFormularioJsonStrict', () => {
	it('aceita objeto', () => {
		const r = parseRespostasFormularioJsonStrict('{"x":true}');
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.data.x).toBe(true);
	});
	it('rejeita array', () => {
		expect(parseRespostasFormularioJsonStrict('[]').ok).toBe(false);
	});
});
