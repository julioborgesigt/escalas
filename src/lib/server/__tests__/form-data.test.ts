import { describe, it, expect } from 'vitest';
import {
	textoLimitado,
	textoLimitadoOuNulo,
	inteiroNaFaixa,
	MAX_EMAIL,
	MAX_OBSERVACOES
} from '../form-data';

function fd(pares: Record<string, string>): FormData {
	const f = new FormData();
	for (const [k, v] of Object.entries(pares)) f.append(k, v);
	return f;
}

describe('textoLimitado', () => {
	it('corta no limite — é o cap que o `maxlength` da tela só promete', () => {
		expect(textoLimitado(fd({ obs: 'a'.repeat(5000) }), 'obs', MAX_OBSERVACOES)).toHaveLength(500);
	});

	it('apara antes de cortar, para o limite valer sobre o conteúdo', () => {
		expect(textoLimitado(fd({ x: '   ab   ' }), 'x', 10)).toBe('ab');
	});

	it('texto dentro do limite passa intacto', () => {
		expect(textoLimitado(fd({ x: 'Plantão 24h' }), 'x', 500)).toBe('Plantão 24h');
	});

	it('campo ausente vira string vazia, nunca undefined', () => {
		expect(textoLimitado(fd({}), 'inexistente', 100)).toBe('');
	});

	it('limite exato não corta nada', () => {
		expect(textoLimitado(fd({ x: 'abcde' }), 'x', 5)).toBe('abcde');
	});
});

describe('textoLimitadoOuNulo', () => {
	it('vazio e só-espaços viram null (coluna anulável = "não informado")', () => {
		expect(textoLimitadoOuNulo(fd({ x: '' }), 'x', 100)).toBeNull();
		expect(textoLimitadoOuNulo(fd({ x: '     ' }), 'x', 100)).toBeNull();
		expect(textoLimitadoOuNulo(fd({}), 'x', 100)).toBeNull();
	});

	it('com conteúdo, corta igual ao `textoLimitado`', () => {
		expect(textoLimitadoOuNulo(fd({ x: 'b'.repeat(300) }), 'x', 200)).toHaveLength(200);
	});
});

describe('MAX_EMAIL', () => {
	it('é o limite da RFC 5321 — o regex de e-mail não impõe tamanho nenhum', () => {
		const gigante = 'a'.repeat(5000) + '@b.com';
		expect(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(gigante)).toBe(true);
		expect(textoLimitado(fd({ e: gigante }), 'e', MAX_EMAIL)).toHaveLength(254);
	});
});

describe('inteiroNaFaixa', () => {
	it('aceita dentro da faixa, extremos incluídos', () => {
		expect(inteiroNaFaixa(fd({ v: '0' }), 'v', 0, 20)).toBe(0);
		expect(inteiroNaFaixa(fd({ v: '20' }), 'v', 0, 20)).toBe(20);
		expect(inteiroNaFaixa(fd({ v: '7' }), 'v', 0, 20)).toBe(7);
	});

	it('recusa fora da faixa — as vagas entram numa comparação SQL de lotação', () => {
		// `999999` apagava o controle de vaga (`COUNT(*) < slots`); `-1` fazia a
		// equipe recusar todo mundo dizendo "vagas esgotadas".
		expect(inteiroNaFaixa(fd({ v: '999999' }), 'v', 0, 20)).toBeNull();
		expect(inteiroNaFaixa(fd({ v: '-1' }), 'v', 0, 20)).toBeNull();
		expect(inteiroNaFaixa(fd({ v: '21' }), 'v', 0, 20)).toBeNull();
	});

	it('recusa não-inteiro e lixo', () => {
		// `0x10` e `1e3` entram na lista de propósito: `Number()` os aceita (16 e
		// 1000), e nenhum sai de um `<input type="number">`.
		for (const ruim of ['1.5', 'abc', 'NaN', 'Infinity', '1e3', '0x10', '  ', '2,5', '+5']) {
			expect(inteiroNaFaixa(fd({ v: ruim }), 'v', 0, 20), ruim).toBeNull();
		}
	});

	it('apara espaços, como o `textoLimitado` — FormData traz o que a tela mandou', () => {
		expect(inteiroNaFaixa(fd({ v: ' 5 ' }), 'v', 0, 20)).toBe(5);
	});

	it('ausente e vazio devolvem null — o chamador distingue de zero', () => {
		expect(inteiroNaFaixa(fd({}), 'v', 0, 20)).toBeNull();
		expect(inteiroNaFaixa(fd({ v: '' }), 'v', 0, 20)).toBeNull();
		// `0` é uma AFIRMAÇÃO (equipe sem aquela vaga), não ausência.
		expect(inteiroNaFaixa(fd({ v: '0' }), 'v', 0, 20)).toBe(0);
	});
});
