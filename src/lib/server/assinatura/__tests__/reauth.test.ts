/**
 * Janela de reautenticação por senha da assinatura avançada.
 *
 * A sessão prova quem é; a senha reinserida prova vontade ATUAL. Estes casos
 * existem para a recusa não viver só no SignaturePad: POST sem janela, senha
 * errada, lote na janela e janela expirada são recusas do SERVIDOR.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import type { Database } from '$lib/db';
import { bancoMigrado, drizzleSobre } from '$lib/db/__tests__/sqlite-migrado';
import { hashSenha } from '$lib/crypto/password-hash';
import { criarJanelaReauth, conferirJanelaReauth, REAUTH_VALIDADE_MS } from '$lib/db/reauth';
import {
	abrirJanelaReauthAssinatura,
	exigirJanelaReauth,
	ERRO_REAUTH_AUSENTE,
	ERRO_REAUTH_INVALIDA
} from '../reauth';
import { validarEvidenciasAvancada } from '../signature-service';
import { ErrorCode } from '../../api';
import type { FlagsAssinatura } from '../cfg-ass-cache';

const SENHA = 'SenhaForte1';
const SESSAO = 'sessao-reauth-teste-64hex-mais-um-pouco-de-padding-ok';
const POLICIAL = { id: 7, tipo: 'policial' as const, nome: 'Fulano', cpf: '12345678901' };

const UA_ANDROID =
	'Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';

function flagsMinimas(): FlagsAssinatura {
	return {
		exigirFotoAssinatura: false,
		exigirGpsAssinatura: false,
		exigirCodigoEmailAssinatura: false,
		restringirSmartphone: false,
		exigirPasskeyAssinatura: false
	};
}

let senhaHash: string;
let sqlite: DatabaseSync;
let db: Database;

beforeAll(async () => {
	senhaHash = await hashSenha(SENHA);
});

beforeEach(() => {
	sqlite = bancoMigrado();
	db = drizzleSobre(sqlite);
	sqlite.exec(
		`INSERT INTO policiais (id, matricula, nome, cargo, lotacao, senha) VALUES (7, 'M7', 'Fulano', 'OIP', 'UNIDADE', '${senhaHash}')`
	);
});

describe('criarJanelaReauth / conferirJanelaReauth', () => {
	it('senha certa abre janela; o lote reutiliza sem consumir', async () => {
		const token = await criarJanelaReauth(db, POLICIAL, SESSAO);
		expect(token).toMatch(/^[0-9a-f]{64}$/);

		await expect(conferirJanelaReauth(db, token, POLICIAL, SESSAO)).resolves.toEqual({ ok: true });
		await expect(conferirJanelaReauth(db, token, POLICIAL, SESSAO)).resolves.toEqual({ ok: true });

		const n = (sqlite.prepare('SELECT COUNT(*) AS n FROM assinatura_reauth').get() as { n: number })
			.n;
		expect(n).toBe(1);
	});

	it('o token em claro nunca chega ao banco', async () => {
		const token = await criarJanelaReauth(db, POLICIAL, SESSAO);
		const guardado = (
			sqlite.prepare('SELECT token_hash FROM assinatura_reauth').get() as { token_hash: string }
		).token_hash;
		expect(guardado).not.toBe(token);
		expect(guardado.startsWith('sha256:')).toBe(true);
	});

	it('janela expirada recusa', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-08-15T12:00:00.000Z'));
		const token = await criarJanelaReauth(db, POLICIAL, SESSAO);
		vi.setSystemTime(new Date(Date.now() + REAUTH_VALIDADE_MS + 1_000));
		await expect(conferirJanelaReauth(db, token, POLICIAL, SESSAO)).resolves.toEqual({
			ok: false,
			motivo: 'invalida'
		});
		vi.useRealTimers();
	});

	it('token de outra sessão ou de outro usuário é inválido, não ausente', async () => {
		const token = await criarJanelaReauth(db, POLICIAL, SESSAO);
		await expect(conferirJanelaReauth(db, token, POLICIAL, 'outra-sessao')).resolves.toEqual({
			ok: false,
			motivo: 'invalida'
		});
		await expect(
			conferirJanelaReauth(db, token, { tipo: 'policial', id: 99 }, SESSAO)
		).resolves.toEqual({ ok: false, motivo: 'invalida' });
	});

	it('ausência de token ou de sessão é motivo ausente', async () => {
		await expect(conferirJanelaReauth(db, null, POLICIAL, SESSAO)).resolves.toEqual({
			ok: false,
			motivo: 'ausente'
		});
		await expect(conferirJanelaReauth(db, 'a'.repeat(64), POLICIAL, null)).resolves.toEqual({
			ok: false,
			motivo: 'ausente'
		});
	});
});

describe('abrirJanelaReauthAssinatura', () => {
	it('senha certa devolve reauthId', async () => {
		const r = await abrirJanelaReauthAssinatura(db, POLICIAL, SENHA, SESSAO, { ip: '10.0.0.1' });
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.reauthId).toMatch(/^[0-9a-f]{64}$/);
	});

	it('senha errada recusa com a mesma frase; depois de N tentativas, 429', async () => {
		for (let i = 0; i < 5; i++) {
			const r = await abrirJanelaReauthAssinatura(db, POLICIAL, 'errada', SESSAO, {
				ip: '10.0.0.1'
			});
			expect(r.ok).toBe(false);
			if (r.ok) return;
			expect(r.status).toBe(401);
			expect(r.error).toBe('Senha incorreta');
		}
		const bloqueado = await abrirJanelaReauthAssinatura(db, POLICIAL, 'errada', SESSAO, {
			ip: '10.0.0.1'
		});
		expect(bloqueado.ok).toBe(false);
		if (bloqueado.ok) return;
		expect(bloqueado.status).toBe(429);
		expect(bloqueado.code).toBe(ErrorCode.RATE_LIMIT);
	});
});

describe('exigirJanelaReauth', () => {
	it('ausente e inválida não revelam o que existe', async () => {
		const ausente = await exigirJanelaReauth(db, POLICIAL, undefined, SESSAO);
		expect(ausente.ok).toBe(false);
		if (ausente.ok) return;
		expect(ausente.status).toBe(403);
		expect(ausente.error).toBe(ERRO_REAUTH_AUSENTE);

		const invalida = await exigirJanelaReauth(db, POLICIAL, 'f'.repeat(64), SESSAO);
		expect(invalida.ok).toBe(false);
		if (invalida.ok) return;
		expect(invalida.error).toBe(ERRO_REAUTH_INVALIDA);
	});
});

describe('validarEvidenciasAvancada — piso de senha', () => {
	it('POST sem reauthId → 403; o documento não nasce desta validação', async () => {
		const r = await validarEvidenciasAvancada(
			db,
			POLICIAL,
			{ userAgent: UA_ANDROID },
			{ flagsOverride: flagsMinimas(), sessaoToken: SESSAO }
		);
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.status).toBe(403);
		expect(r.error).toBe(ERRO_REAUTH_AUSENTE);
	});

	it('janela válida passa o gate de senha', async () => {
		const reauthId = await criarJanelaReauth(db, POLICIAL, SESSAO);
		const r = await validarEvidenciasAvancada(
			db,
			POLICIAL,
			{ userAgent: UA_ANDROID, reauthId },
			{ flagsOverride: flagsMinimas(), sessaoToken: SESSAO }
		);
		expect(r.ok).toBe(true);
	});
});
