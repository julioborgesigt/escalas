import { describe, it, expect } from 'vitest';
import { textoLimitado, textoLimitadoOuNulo, MAX_EMAIL, MAX_OBSERVACOES } from '../form-data';

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
