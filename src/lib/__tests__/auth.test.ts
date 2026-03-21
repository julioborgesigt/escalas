import { describe, it, expect } from 'vitest';
import { hashSenha, gerarToken } from '../auth';

describe('hashSenha', () => {
	it('produz hash SHA-256 correto para a senha padrão', async () => {
		const hash = await hashSenha('12345678');
		expect(hash).toBe('ef797c8118f02dfb649607dd5d3f8c7623048c9c063d532cc95c5ed7a898a64f');
	});

	it('produz hash SHA-256 correto para admin123', async () => {
		const hash = await hashSenha('admin123');
		expect(hash).toBe('240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9');
	});

	it('retorna string hex de 64 caracteres', async () => {
		const hash = await hashSenha('qualquercoisa');
		expect(hash).toMatch(/^[0-9a-f]{64}$/);
	});

	it('hashes diferentes para senhas diferentes', async () => {
		const hash1 = await hashSenha('senha001');
		const hash2 = await hashSenha('senha002');
		expect(hash1).not.toBe(hash2);
	});
});

describe('gerarToken', () => {
	it('retorna string hex de 64 caracteres', () => {
		const token = gerarToken();
		expect(token).toMatch(/^[0-9a-f]{64}$/);
	});

	it('gera tokens únicos', () => {
		const tokens = new Set(Array.from({ length: 10 }, () => gerarToken()));
		expect(tokens.size).toBe(10);
	});
});
