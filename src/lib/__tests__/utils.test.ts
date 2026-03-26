import { describe, it, expect } from 'vitest';
import { limparMatricula, formatarTelefone } from '../utils';

describe('formatarTelefone', () => {
	it('formata 11 dígitos no padrão (88) 9.8888-8888', () => {
		expect(formatarTelefone('88988888888')).toBe('(88) 9.8888-8888');
	});

	it('formata 10 dígitos no padrão (88) 8888-8888', () => {
		expect(formatarTelefone('8888888888')).toBe('(88) 8888-8888');
	});

	it('formata progressivamente 11 dígitos', () => {
		expect(formatarTelefone('8')).toBe('(8');
		expect(formatarTelefone('88')).toBe('(88');
		expect(formatarTelefone('889')).toBe('(88) 9.');
		expect(formatarTelefone('8891')).toBe('(88) 9.1');
		expect(formatarTelefone('8891234')).toBe('(88) 9.1234-');
		expect(formatarTelefone('88912345')).toBe('(88) 9.1234-5');
	});

	it('formata progressivamente 10 dígitos (fixo)', () => {
		expect(formatarTelefone('883')).toBe('(88) 3');
		expect(formatarTelefone('883456')).toBe('(88) 3456');
		expect(formatarTelefone('8834567')).toBe('(88) 3456-7');
	});

	it('não ultrapassa 11 dígitos', () => {
		expect(formatarTelefone('112222233334444')).toBe('(11) 2.2222-3333');
	});

	it('retorna vazio para entrada vazia', () => {
		expect(formatarTelefone('')).toBe('');
	});
});


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
