/**
 * `executarLimpezaRetencao` contra um SQLite REAL com todas as migrações — o
 * expurgo em si, que até aqui não tinha teste nenhum (o `lgpd-retencao.test.ts`
 * cobre só a parte pura do failsafe).
 *
 * O que este arquivo existe para impedir é uma classe específica de erro: o
 * corte comparado num FORMATO diferente do que a coluna guarda. As colunas de
 * data do projeto usam duas convenções, e as duas são UTC:
 *
 *   - `datetime('now')` do SQLite → `"2026-07-02 12:00:00"` (espaço, sem `Z`);
 *   - `Date#toISOString()` do app → `"2026-07-02T12:00:00.000Z"` (T e `Z`).
 *
 * Em SQLite a comparação de TEXT é lexicográfica, e `' '` (0x20) vem ANTES de
 * `'T'` (0x54). Cortar uma coluna do primeiro formato com um limite do segundo
 * faz toda linha do MESMO DIA do corte parecer mais antiga que ele, qualquer que
 * seja a hora — apagando até 24h a mais de dado pessoal, silenciosamente, a cada
 * execução. Por isso cada tabela abaixo tem um caso "no dia do corte, porém
 * depois dele": é o único que distingue o corte certo do errado.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import type { Database } from '$lib/db';
import { executarLimpezaRetencao } from '../retencao';
import { bancoMigrado, drizzleSobre } from '../../__tests__/sqlite-migrado';

/** Instante congelado de referência; todos os casos são relativos a ele. */
const AGORA = new Date('2026-08-01T12:00:00.000Z');
/** Retenção usada em todos os casos, para o corte cair sempre em 02/07 12:00Z. */
const DIAS = 30;

let sqlite: DatabaseSync;
let db: Database;

/** Config com a MESMA janela em todos os campos: o corte é o mesmo para todos. */
const config = {
	sessoesDias: DIAS,
	loginAttemptsDias: DIAS,
	doisFatoresDias: DIAS,
	resetTokensDias: DIAS,
	recoveryAttemptsDias: DIAS,
	webhookNoncesDias: DIAS,
	auditLogAnos: DIAS / 365,
	appLogDias: DIAS
};

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(AGORA);

	sqlite = bancoMigrado();
	db = drizzleSobre(sqlite);
});

afterAll(() => vi.useRealTimers());

/** Ids sobreviventes de uma tabela, em ordem. */
function sobreviventes(tabela: string, coluna = 'id'): unknown[] {
	return (
		sqlite.prepare(`SELECT ${coluna} AS v FROM ${tabela} ORDER BY ${coluna}`).all() as {
			v: unknown;
		}[]
	).map((r) => r.v);
}

/**
 * Os quatro casos que todo teste abaixo repete, com `ts` no formato da coluna:
 * 1 = muito antes do corte, 2 = no dia do corte mas ANTES, 3 = no dia do corte
 * e DEPOIS, 4 = muito depois. Sobreviventes esperados: sempre 3 e 4.
 */
const CASOS_SQLITE = [
	{ id: 1, ts: '2026-06-01 12:00:00' },
	{ id: 2, ts: '2026-07-02 06:00:00' },
	{ id: 3, ts: '2026-07-02 18:00:00' },
	{ id: 4, ts: '2026-07-10 12:00:00' }
];
const CASOS_ISO = [
	{ id: 1, ts: '2026-06-01T12:00:00.000Z' },
	{ id: 2, ts: '2026-07-02T06:00:00.000Z' },
	{ id: 3, ts: '2026-07-02T18:00:00.000Z' },
	{ id: 4, ts: '2026-07-10T12:00:00.000Z' }
];

describe('executarLimpezaRetencao — colunas no formato do SQLite', () => {
	it('login_attempts preserva a linha do dia do corte que é POSTERIOR a ele', async () => {
		for (const { id, ts } of CASOS_SQLITE) {
			sqlite.exec(
				`INSERT INTO login_attempts (id, ip, attempted_at) VALUES (${id}, '10.0.0.1', '${ts}')`
			);
		}
		await executarLimpezaRetencao(db, config);
		expect(sobreviventes('login_attempts')).toEqual([3, 4]);
	});

	it('recovery_attempts idem', async () => {
		for (const { id, ts } of CASOS_SQLITE) {
			sqlite.exec(
				`INSERT INTO recovery_attempts (id, ip, purpose, attempted_at) VALUES (${id}, '10.0.0.1', 'reset', '${ts}')`
			);
		}
		await executarLimpezaRetencao(db, config);
		expect(sobreviventes('recovery_attempts')).toEqual([3, 4]);
	});

	it('webhook_nonces idem', async () => {
		for (const { id, ts } of CASOS_SQLITE) {
			sqlite.exec(`INSERT INTO webhook_nonces (nonce, received_at) VALUES ('n${id}', '${ts}')`);
		}
		await executarLimpezaRetencao(db, config);
		expect(sobreviventes('webhook_nonces', 'nonce')).toEqual(['n3', 'n4']);
	});

	it('audit_log — trilha forense não pode perder evento dentro do prazo', async () => {
		for (const { id, ts } of CASOS_SQLITE) {
			sqlite.exec(
				`INSERT INTO audit_log (id, acao, entidade, created_at) VALUES (${id}, 'teste', 'escala', '${ts}')`
			);
		}
		await executarLimpezaRetencao(db, config);
		expect(sobreviventes('audit_log')).toEqual([3, 4]);
	});

	it('app_log idem', async () => {
		for (const { id, ts } of CASOS_SQLITE) {
			sqlite.exec(
				`INSERT INTO app_log (id, level, message, created_at) VALUES (${id}, 'warn', 'msg', '${ts}')`
			);
		}
		await executarLimpezaRetencao(db, config);
		expect(sobreviventes('app_log')).toEqual([3, 4]);
	});
});

describe('executarLimpezaRetencao — colunas no formato ISO do app', () => {
	it('sessoes corta por expires_at sem regressão', async () => {
		for (const { id, ts } of CASOS_ISO) {
			sqlite.exec(
				`INSERT INTO sessoes (id, token, tipo, usuario_id, expires_at) VALUES (${id}, 't${id}', 'policial', 1, '${ts}')`
			);
		}
		await executarLimpezaRetencao(db, config);
		expect(sobreviventes('sessoes')).toEqual([3, 4]);
	});

	it('dois_fatores_tokens e reset_senha_tokens idem', async () => {
		for (const { id, ts } of CASOS_ISO) {
			sqlite.exec(
				`INSERT INTO dois_fatores_tokens (id, desafio_id, tipo, usuario_id, codigo, expires_at) VALUES (${id}, 'd${id}', 'policial', 1, 'c', '${ts}')`
			);
			sqlite.exec(
				`INSERT INTO reset_senha_tokens (id, token, tipo_usuario, usuario_id, expires_at) VALUES (${id}, 'r${id}', 'policial', 1, '${ts}')`
			);
		}
		await executarLimpezaRetencao(db, config);
		expect(sobreviventes('dois_fatores_tokens')).toEqual([3, 4]);
		expect(sobreviventes('reset_senha_tokens')).toEqual([3, 4]);
	});

	it('assinatura_reauth corta por expires_at no formato ISO', async () => {
		for (const { id, ts } of CASOS_ISO) {
			sqlite.exec(
				`INSERT INTO assinatura_reauth (id, token_hash, usuario_tipo, usuario_id, sessao_hash, expires_at) VALUES (${id}, 'h${id}', 'policial', 1, 's${id}', '${ts}')`
			);
		}
		const r = await executarLimpezaRetencao(db, config);
		expect(sobreviventes('assinatura_reauth')).toEqual([3, 4]);
		expect(r.assinaturaReauth).toBe(2);
	});

	it('passkey_reposicao corta por expires_at no formato ISO', async () => {
		for (const { id, ts } of CASOS_ISO) {
			sqlite.exec(
				`INSERT INTO passkey_reposicao (id, desafio_id, usuario_tipo, usuario_id, canal, codigo_hash, expires_at) VALUES (${id}, 'd${id}', 'policial', 1, 'institucional', 'h${id}', '${ts}')`
			);
		}
		const r = await executarLimpezaRetencao(db, config);
		expect(sobreviventes('passkey_reposicao')).toEqual([3, 4]);
		expect(r.passkeyReposicao).toBe(2);
	});
});

describe('executarLimpezaRetencao — contagem devolvida', () => {
	it('reporta quantas linhas saíram de cada tabela', async () => {
		for (const { id, ts } of CASOS_SQLITE) {
			sqlite.exec(
				`INSERT INTO app_log (id, level, message, created_at) VALUES (${id}, 'warn', 'msg', '${ts}')`
			);
		}
		const r = await executarLimpezaRetencao(db, config);
		expect(r.appLog).toBe(2);
	});
});
