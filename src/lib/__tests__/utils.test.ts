import { describe, it, expect } from 'vitest';
import { limparMatricula } from '../utils';

describe('limparMatricula', () => {
	it('remove pontos e hífens', () => {
		expect(limparMatricula('301.095-1-1')).toBe('30109511');
	});

	it('retorna string vazia para entrada vazia', () => {
		expect(limparMatricula('')).toBe('');
	});

	it('retorna string vazia para entrada falsy', () => {
		expect(limparMatricula(null as unknown as string)).toBe('');
		expect(limparMatricula(undefined as unknown as string)).toBe('');
	});

	it('retorna inalterada quando não há pontos ou hífens', () => {
		expect(limparMatricula('12345678')).toBe('12345678');
	});

	it('remove espaços laterais', () => {
		expect(limparMatricula('  123.456  ')).toBe('123456');
	});

	it('lida com números puros', () => {
		expect(limparMatricula(12345 as unknown as string)).toBe('12345');
	});
});
