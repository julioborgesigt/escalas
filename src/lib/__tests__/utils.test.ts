import { describe, it, expect } from 'vitest';
import {
	limparMatricula,
	formatarTelefone,
	formatarNUP,
	adicionarDias,
	diffDiasInclusivo
} from '../utils';

describe('formatarNUP', () => {
	it('aplica a máscara completa 00000.000000/0000-00', () => {
		expect(formatarNUP('00000000000000000')).toBe('00000.000000/0000-00');
		expect(formatarNUP('12345678901234567')).toBe('12345.678901/2345-67');
	});

	it('preenche progressivamente os separadores', () => {
		expect(formatarNUP('12345')).toBe('12345');
		expect(formatarNUP('123456')).toBe('12345.6');
		expect(formatarNUP('12345678901')).toBe('12345.678901');
		expect(formatarNUP('123456789012')).toBe('12345.678901/2');
		expect(formatarNUP('1234567890123456')).toBe('12345.678901/2345-6');
	});

	it('ignora caracteres não numéricos e limita a 17 dígitos', () => {
		expect(formatarNUP('abc12345def678901/2345-670000')).toBe('12345.678901/2345-67');
	});
});

describe('adicionarDias', () => {
	it('soma dias atravessando o mês', () => {
		expect(adicionarDias('2026-01-30', 3)).toBe('2026-02-02');
	});
	it('aceita zero e valores negativos', () => {
		expect(adicionarDias('2026-07-22', 0)).toBe('2026-07-22');
		expect(adicionarDias('2026-03-01', -1)).toBe('2026-02-28');
	});
	it('devolve a entrada quando o formato é inválido', () => {
		expect(adicionarDias('22/07/2026', 1)).toBe('22/07/2026');
	});
});

describe('diffDiasInclusivo', () => {
	it('conta o dia inicial (1 dia para datas iguais)', () => {
		expect(diffDiasInclusivo('2026-01-01', '2026-01-01')).toBe(1);
	});
	it('conta o período inclusivo', () => {
		expect(diffDiasInclusivo('2026-01-01', '2026-01-10')).toBe(10);
	});
	it('retorna 0 quando fim < início ou datas inválidas', () => {
		expect(diffDiasInclusivo('2026-01-10', '2026-01-01')).toBe(0);
		expect(diffDiasInclusivo('', '2026-01-01')).toBe(0);
	});
});

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
