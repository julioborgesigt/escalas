import { describe, it, expect, vi } from 'vitest';
import {
	hashSenha,
	verificarSenha,
	isHashLegado,
	gerarToken,
	gerarSenhaAleatoriaHash,
	compararSegredoUtf8TimingSafe,
	verificarDesafio2FA,
	type TipoDesafio2FA
} from '../auth';
import type { Database } from '$lib/db';

describe('hashSenha (PBKDF2)', () => {
	it('produz hash no formato pbkdf2v2:<iter>:<salt>:<hash>', async () => {
		const hash = await hashSenha('minhaSenha');
		expect(hash).toMatch(/^pbkdf2v2:100000:[0-9a-f]{32}:[0-9a-f]{64}$/);
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

	it('rejeita hash SHA-256 legado (suporte pré-PBKDF2 removido)', async () => {
		// SHA-256 de "12345678" — formato legado não é mais aceito (B5 da auditoria).
		const legacyHash = 'ef797c8118f02dfb649607dd5d3f8c7623048c9c063d532cc95c5ed7a898a64f';
		expect(await verificarSenha('12345678', legacyHash)).toBe(false);
		expect(await verificarSenha('87654321', legacyHash)).toBe(false);
	});

	it('rejeita hash malformado', async () => {
		expect(await verificarSenha('qualquer', 'pbkdf2v1:invalido')).toBe(false);
		expect(await verificarSenha('qualquer', 'pbkdf2v2:invalido')).toBe(false);
		expect(await verificarSenha('qualquer', '')).toBe(false);
	});

	it('rejeita iter fora da janela razoável (defesa anti-DoS no v2)', async () => {
		// iter = 0 ou negativo: malformado
		expect(await verificarSenha('x', 'pbkdf2v2:0:abc:def')).toBe(false);
		// iter > 10M: bloqueia DoS de derivação
		expect(await verificarSenha('x', 'pbkdf2v2:99999999:abc:def')).toBe(false);
	});

	it('continua aceitando hash PBKDF2 v1 (100k) gravado antes do upgrade', async () => {
		// Hash gerado por `hashSenha("senhaSegura")` no formato antigo:
		// pbkdf2v1:<salt>:<hash> com 100 000 iterações. Salt e hash abaixo
		// são determinísticos para o test (gerados offline com o algoritmo v1).
		const salt = 'a1b2c3d4e5f607182a3b4c5d6e7f8090';
		// Re-deriva via API atual com iter=100k para obter o hash esperado
		// e simular um registro v1 legítimo no banco.
		const enc = new TextEncoder();
		const km = await crypto.subtle.importKey(
			'raw',
			enc.encode('senhaSegura') as BufferSource,
			'PBKDF2',
			false,
			['deriveBits']
		);
		const saltBytes = new Uint8Array(salt.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
		const hb = await crypto.subtle.deriveBits(
			{ name: 'PBKDF2', salt: saltBytes as BufferSource, iterations: 100_000, hash: 'SHA-256' },
			km,
			256
		);
		const hashHex = Array.from(new Uint8Array(hb))
			.map((b) => b.toString(16).padStart(2, '0'))
			.join('');
		const v1Hash = `pbkdf2v1:${salt}:${hashHex}`;

		expect(await verificarSenha('senhaSegura', v1Hash)).toBe(true);
		expect(await verificarSenha('senhaErrada', v1Hash)).toBe(false);
	});
});

describe('isHashLegado', () => {
	it('identifica hash SHA-256 como legado', () => {
		expect(isHashLegado('ef797c8118f02dfb649607dd5d3f8c7623048c9c063d532cc95c5ed7a898a64f')).toBe(
			true
		);
	});

	it('identifica hash PBKDF2 v1 (100k) como legado — força re-hash para v2', () => {
		expect(isHashLegado('pbkdf2v1:abc123:def456')).toBe(true);
	});

	it('identifica hash PBKDF2 v2 como atual quando NÃO há pepper', () => {
		// Sem pepper (default), v2 é o alvo — não re-hasheia no login.
		expect(isHashLegado('pbkdf2v2:100000:abc123:def456')).toBe(false);
		expect(isHashLegado('pbkdf2v2:600000:abc123:def456')).toBe(false);
	});

	it('com pepper ativo, v2/v1/legado viram legado (sobem para v3)', () => {
		expect(isHashLegado('pbkdf2v2:100000:abc123:def456', true)).toBe(true);
		expect(isHashLegado('pbkdf2v1:abc:def', true)).toBe(true);
		expect(
			isHashLegado('ef797c8118f02dfb649607dd5d3f8c7623048c9c063d532cc95c5ed7a898a64f', true)
		).toBe(true);
	});

	it('v3 nunca é legado (com ou sem pepper) — não rebaixa', () => {
		expect(isHashLegado('pbkdf2v3:100000:abc:def', true)).toBe(false);
		expect(isHashLegado('pbkdf2v3:100000:abc:def', false)).toBe(false);
	});
});

describe('pepper (pbkdf2v3 — achado A3)', () => {
	const PEPPER = 'pepper-de-teste-deadbeef';

	it('hashSenha com pepper emite formato pbkdf2v3', async () => {
		const hash = await hashSenha('minhaSenha', PEPPER);
		expect(hash).toMatch(/^pbkdf2v3:100000:[0-9a-f]{32}:[0-9a-f]{64}$/);
	});

	it('hashSenha sem pepper continua emitindo v2 (fallback)', async () => {
		const hash = await hashSenha('minhaSenha');
		expect(hash).toMatch(/^pbkdf2v2:100000:/);
	});

	it('verificarSenha confere v3 com o pepper correto', async () => {
		const hash = await hashSenha('senhaForte', PEPPER);
		expect(await verificarSenha('senhaForte', hash, PEPPER)).toBe(true);
		expect(await verificarSenha('senhaErrada', hash, PEPPER)).toBe(false);
	});

	it('verificarSenha REJEITA v3 com pepper errado ou ausente (fail-closed)', async () => {
		const hash = await hashSenha('senhaForte', PEPPER);
		expect(await verificarSenha('senhaForte', hash, 'pepper-errado')).toBe(false);
		expect(await verificarSenha('senhaForte', hash)).toBe(false);
		expect(await verificarSenha('senhaForte', hash, undefined)).toBe(false);
	});

	it('o pepper muda o hash para a mesma senha (HMAC aplicado)', async () => {
		// hashes v3 com peppers diferentes não se verificam cruzado
		const h1 = await hashSenha('igual', 'pepperA-aaaaaaaaaaaaaaaa');
		expect(await verificarSenha('igual', h1, 'pepperB-bbbbbbbbbbbbbbbb')).toBe(false);
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

describe('compararSegredoUtf8TimingSafe', () => {
	it('aceita par exato', () => {
		expect(compararSegredoUtf8TimingSafe('segredo', 'segredo')).toBe(true);
	});
	it('rejeita senha errada mesmo comprimento', () => {
		expect(compararSegredoUtf8TimingSafe('segredo1', 'segredo2')).toBe(false);
	});
	it('rejeita comprimentos diferentes', () => {
		expect(compararSegredoUtf8TimingSafe('curto', 'curtoo')).toBe(false);
	});
	it('suporta UTF-8', () => {
		expect(compararSegredoUtf8TimingSafe('café', 'café')).toBe(true);
		expect(compararSegredoUtf8TimingSafe('café', 'cafe')).toBe(false);
	});
});

// A cobertura de `verificarDesafio2FA` mora em `desafio-2fa-uso-unico.test.ts`,
// contra um SQLite real: o que ela verifica — uso único, teto de tentativas,
// separação de canais — é comportamento do SQL, e um `fakeDb` do query builder
// se prendia à FORMA da consulta (quebrou ao trocar o UPDATE por um
// condicional com RETURNING) em vez de ao contrato.

describe('gerarSenhaAleatoriaHash', () => {
	it('retorna hash PBKDF2 v2 válido', async () => {
		const hash = await gerarSenhaAleatoriaHash();
		expect(hash).toMatch(/^pbkdf2v2:100000:[0-9a-f]{32}:[0-9a-f]{64}$/);
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
