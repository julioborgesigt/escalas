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
		expect(hash).toMatch(/^pbkdf2v2:600000:[0-9a-f]{32}:[0-9a-f]{64}$/);
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
		expect(isHashLegado('ef797c8118f02dfb649607dd5d3f8c7623048c9c063d532cc95c5ed7a898a64f')).toBe(true);
	});

	it('identifica hash PBKDF2 v1 (100k) como legado — força re-hash para v2', () => {
		expect(isHashLegado('pbkdf2v1:abc123:def456')).toBe(true);
	});

	it('identifica hash PBKDF2 v2 (600k) como atual', () => {
		expect(isHashLegado('pbkdf2v2:600000:abc123:def456')).toBe(false);
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

describe('verificarDesafio2FA — expectedTipos (defense in depth)', () => {
	async function sha256Hex(s: string): Promise<string> {
		const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
		return Array.from(new Uint8Array(buf))
			.map((b) => b.toString(16).padStart(2, '0'))
			.join('');
	}

	type FakeRow = {
		id: number;
		desafio_id: string;
		tipo: TipoDesafio2FA;
		usuario_id: number;
		codigo: string;
		expires_at: string;
		tentativas: number;
		usado: 0 | 1;
	};

	function fakeDb(row: FakeRow | null) {
		const get = vi.fn().mockResolvedValue(row);
		const where = vi.fn().mockReturnValue({ get });
		const from = vi.fn().mockReturnValue({ where });
		const select = vi.fn().mockReturnValue({ from });
		const update = vi.fn().mockReturnValue({
			set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) })
		});
		return { select, update } as unknown as Database;
	}

	async function makeRow(tipo: TipoDesafio2FA, codigo = '123456'): Promise<FakeRow> {
		return {
			id: 1,
			desafio_id: 'd1',
			tipo,
			usuario_id: 42,
			codigo: await sha256Hex(codigo),
			expires_at: new Date(Date.now() + 60_000).toISOString(),
			tentativas: 0,
			usado: 0
		};
	}

	it('aceita desafio quando tipo está em expectedTipos', async () => {
		const row = await makeRow('policial');
		const db = fakeDb(row);
		const result = await verificarDesafio2FA(db, 'd1', '123456', ['policial', 'admin']);
		expect(result).toEqual({ tipo: 'policial', usuarioId: 42 });
	});

	it('REJEITA desafio "assinatura" submetido em canal de login (bug C2)', async () => {
		// Ataque: atacante captura desafioId de e-mail de assinatura e
		// submete em /api/auth/verificar-2fa para criar sessão sem senha.
		const row = await makeRow('assinatura');
		const db = fakeDb(row);
		const result = await verificarDesafio2FA(db, 'd1', '123456', ['policial', 'admin']);
		expect(result).toBeNull();
	});

	it('REJEITA desafio "reset_policial" submetido em canal de assinatura', async () => {
		const row = await makeRow('reset_policial');
		const db = fakeDb(row);
		const result = await verificarDesafio2FA(db, 'd1', '123456', ['assinatura']);
		expect(result).toBeNull();
	});

	it('aceita reset_policial OU reset_admin no canal de reset', async () => {
		const dbA = fakeDb(await makeRow('reset_policial'));
		expect(await verificarDesafio2FA(dbA, 'd1', '123456', ['reset_policial', 'reset_admin']))
			.toEqual({ tipo: 'reset_policial', usuarioId: 42 });

		const dbB = fakeDb(await makeRow('reset_admin'));
		expect(await verificarDesafio2FA(dbB, 'd1', '123456', ['reset_policial', 'reset_admin']))
			.toEqual({ tipo: 'reset_admin', usuarioId: 42 });
	});

	it('NOVO canal `verificacao_email` é separado de `assinatura` (I-2)', async () => {
		// Desafio criado no canal de verificação de e-mail NÃO pode ser
		// submetido em canal de assinatura (e vice-versa).
		const dbVerif = fakeDb(await makeRow('verificacao_email'));
		expect(await verificarDesafio2FA(dbVerif, 'd1', '123456', ['assinatura']))
			.toBeNull();

		const dbAss = fakeDb(await makeRow('assinatura'));
		expect(await verificarDesafio2FA(dbAss, 'd1', '123456', ['verificacao_email']))
			.toBeNull();
	});

	it('bindExtra amarra o código ao e-mail (I-1)', async () => {
		// Cria desafio amarrado a email_A. Verificar com email_B falha mesmo
		// que o código esteja correto. Pré-requisito: o `codigo` do row de
		// teste precisa ser o hash do `extra\x1fcodigo` esperado.
		async function sha256HexBound(extra: string, codigo: string): Promise<string> {
			const enc = new TextEncoder();
			const buf = await crypto.subtle.digest(
				'SHA-256',
				enc.encode(`${extra}\x1f${codigo}`)
			);
			return Array.from(new Uint8Array(buf))
				.map((b) => b.toString(16).padStart(2, '0'))
				.join('');
		}

		const row: FakeRow = {
			id: 1,
			desafio_id: 'd1',
			tipo: 'verificacao_email',
			usuario_id: 42,
			codigo: await sha256HexBound('a@b.com', '123456'),
			expires_at: new Date(Date.now() + 60_000).toISOString(),
			tentativas: 0,
			usado: 0
		};
		const db = fakeDb(row);

		// E-mail correto + código correto → ok.
		expect(
			await verificarDesafio2FA(db, 'd1', '123456', ['verificacao_email'], 'a@b.com')
		).toEqual({ tipo: 'verificacao_email', usuarioId: 42 });

		// E-mail trocado → null (mesmo código correto, hash diverge).
		const db2 = fakeDb({
			...row,
			codigo: await sha256HexBound('a@b.com', '123456'),
			tentativas: 0,
			usado: 0
		});
		expect(
			await verificarDesafio2FA(db2, 'd1', '123456', ['verificacao_email'], 'evil@evil.com')
		).toBeNull();
	});

	it('retorna null para desafio inexistente', async () => {
		const db = fakeDb(null);
		const result = await verificarDesafio2FA(db, 'd1', '123456', ['policial']);
		expect(result).toBeNull();
	});

	it('retorna "expirado" quando passou da validade (mesmo com tipo correto)', async () => {
		const row = await makeRow('policial');
		row.expires_at = new Date(Date.now() - 1000).toISOString();
		const db = fakeDb(row);
		const result = await verificarDesafio2FA(db, 'd1', '123456', ['policial']);
		expect(result).toBe('expirado');
	});

	it('mismatch de tipo retorna null ANTES de expirado/esgotado (não vaza estado)', async () => {
		// Garantia: tipo errado é indistinguível de "código não existe".
		const row = await makeRow('assinatura');
		row.expires_at = new Date(Date.now() - 1000).toISOString(); // expirado
		row.tentativas = 99; // esgotado
		const db = fakeDb(row);
		const result = await verificarDesafio2FA(db, 'd1', '123456', ['policial']);
		expect(result).toBeNull();
	});
});

describe('gerarSenhaAleatoriaHash', () => {
	it('retorna hash PBKDF2 v2 válido', async () => {
		const hash = await gerarSenhaAleatoriaHash();
		expect(hash).toMatch(/^pbkdf2v2:600000:[0-9a-f]{32}:[0-9a-f]{64}$/);
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
