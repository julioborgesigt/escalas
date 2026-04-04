import { describe, it, expect } from 'vitest';
import { hashSenha, verificarSenha, isHashLegado, gerarToken, gerarSenhaAleatoriaHash } from '../auth';

describe('hashSenha (PBKDF2)', () => {
	it('produz hash no formato pbkdf2v1:<salt>:<hash>', async () => {
		const hash = await hashSenha('minhaSenha');
		expect(hash).toMatch(/^pbkdf2v1:[0-9a-f]{32}:[0-9a-f]{64}$/);
	});

	it('gera salt diferente para cada chamada (mesmo input)', async () => {
		const hash1 = await hashSenha('mesmaSenha');
		const hash2 = await hashSenha('mesmaSenha');
		expect(hash1).not.toBe(hash2); // salts diferentes
	});
});

describe('verificarSenha', () => {
	it('verifica corretamente hash PBKDF2', async () => {
		const hash = await hashSenha('senhaSegura');
		expect(await verificarSenha('senhaSegura', hash)).toBe(true);
		expect(await verificarSenha('senhaErrada', hash)).toBe(false);
	});

	it('verifica corretamente hash SHA-256 legado', async () => {
		// SHA-256 de "12345678"
		const legacyHash = 'ef797c8118f02dfb649607dd5d3f8c7623048c9c063d532cc95c5ed7a898a64f';
		expect(await verificarSenha('12345678', legacyHash)).toBe(true);
		expect(await verificarSenha('87654321', legacyHash)).toBe(false);
	});

	it('rejeita hash malformado', async () => {
		expect(await verificarSenha('qualquer', 'pbkdf2v1:invalido')).toBe(false);
		expect(await verificarSenha('qualquer', '')).toBe(false);
	});
});

describe('isHashLegado', () => {
	it('identifica hash SHA-256 como legado', () => {
		expect(isHashLegado('ef797c8118f02dfb649607dd5d3f8c7623048c9c063d532cc95c5ed7a898a64f')).toBe(true);
	});

	it('identifica hash PBKDF2 como não-legado', () => {
		expect(isHashLegado('pbkdf2v1:abc123:def456')).toBe(false);
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

describe('gerarSenhaAleatoriaHash', () => {
	it('retorna hash PBKDF2 válido', async () => {
		const hash = await gerarSenhaAleatoriaHash();
		expect(hash).toMatch(/^pbkdf2v1:[0-9a-f]{32}:[0-9a-f]{64}$/);
	});

	it('gera hashes diferentes a cada chamada', async () => {
		const h1 = await gerarSenhaAleatoriaHash();
		const h2 = await gerarSenhaAleatoriaHash();
		expect(h1).not.toBe(h2);
	});

	it('hash gerado não corresponde a senhas comuns', async () => {
		const hash = await gerarSenhaAleatoriaHash();
		expect(await verificarSenha('12345678', hash)).toBe(false);
		expect(await verificarSenha('admin123', hash)).toBe(false);
		expect(await verificarSenha('password', hash)).toBe(false);
	});
});
