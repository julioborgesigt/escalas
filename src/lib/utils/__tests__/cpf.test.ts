/**
 * `cpfValido` — o que a regex de forma do `policialSchema` deixa passar e este
 * módulo recusa. Os CPFs de exemplo foram escolhidos pelo CAMINHO que exercitam
 * no cálculo (resto 10 em cada dígito, sequência repetida), não por serem de
 * alguém.
 */
import { describe, it, expect } from 'vitest';
import { cpfValido } from '../cpf';

describe('cpfValido', () => {
	it('aceita CPF válido, com e sem máscara', () => {
		expect(cpfValido('52998224725')).toBe(true);
		expect(cpfValido('529.982.247-25')).toBe(true);
		expect(cpfValido(' 529982247-25 ')).toBe(true);
	});

	it('resto 10 no cálculo vira dígito 0 — nos dois dígitos', () => {
		// 1º dígito: soma*10 % 11 === 10 → 0
		expect(cpfValido('10000000108')).toBe(true);
		// 2º dígito: idem
		expect(cpfValido('10000002810')).toBe(true);
	});

	it('recusa dígito verificador errado — em qualquer um dos dois', () => {
		expect(cpfValido('52998224735')).toBe(false); // 1º dígito trocado
		expect(cpfValido('52998224726')).toBe(false); // 2º dígito trocado
	});

	it('recusa as onze sequências repetidas, que passam no cálculo', () => {
		for (let d = 0; d <= 9; d++) {
			expect(cpfValido(String(d).repeat(11))).toBe(false);
			expect(cpfValido(`${d}${d}${d}.${d}${d}${d}.${d}${d}${d}-${d}${d}`)).toBe(false);
		}
	});

	it('recusa tamanho diferente de 11 dígitos', () => {
		expect(cpfValido('5299822472')).toBe(false); // 10
		expect(cpfValido('529982247251')).toBe(false); // 12
		expect(cpfValido('')).toBe(false);
	});

	it('entrada vazia ou não textual devolve false, sem lançar', () => {
		expect(cpfValido(null)).toBe(false);
		expect(cpfValido(undefined)).toBe(false);
		expect(cpfValido('abc')).toBe(false);
	});

	it('só dígitos contam: letras misturadas não completam um CPF', () => {
		// "limparCPF" tira o que não é dígito; o que sobra tem de ser válido por si.
		expect(cpfValido('529a982b247c25')).toBe(true);
		expect(cpfValido('529a982b247c2')).toBe(false);
	});
});
