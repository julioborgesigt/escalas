/**
 * As DUAS convenções de fuso das colunas em formato SQLite — e o que acontece
 * quando se escolhe a errada.
 *
 * O projeto guarda data em TEXT de três jeitos, e dois deles são
 * `"YYYY-MM-DD HH:MM:SS"`:
 *
 *   `datetime('now')`             → UTC       (audit_log, app_log, login_attempts…)
 *   `datetime('now', '-3 hours')` → Brasília  (dois_fatores_tokens, reset_senha_tokens…)
 *   `toISOString()` do app        → `"…T…Z"`  (os `expires_at`)
 *
 * Misturar os dois primeiros com o terceiro foi o bug 1.1 desta auditoria (a
 * expurga LGPD apagando 24h a mais de dado pessoal). Misturar o primeiro com o
 * segundo é a casa seguinte do mesmo erro, e foi o que a revisão encontrou:
 * TRÊS limites de taxa comparavam `created_at` — que guarda Brasília — com um
 * `toISOString()`. O contador dava ZERO e o limite nunca disparava:
 *
 *   - `/api/auth/confirmar-redefinicao` — nº de links de redefinição por usuário
 *   - `/api/auth/solicitar-redefinicao` — nº de códigos de reset por usuário
 *   - `/api/auth/solicitar-verificacao-email-pessoal` — nº de códigos de e-mail
 *   - `contarRecoveryAttempts` — throttle de reauth da assinatura (e dos
 *     demais purposes em `recovery_attempts`, cuja coluna é `datetime('now')`)
 *
 * Os quatro protegem contra inundar a caixa de entrada de um servidor e contra
 * força bruta sobre código de 6 dígitos. Não falhavam: simplesmente não
 * contavam.
 *
 * Contra SQLite real, porque o que está sob teste é a COMPARAÇÃO lexicográfica
 * de TEXT do próprio banco.
 *
 * ATENÇÃO ao escrever caso novo aqui: `datetime('now')` do DEFAULT lê o relógio
 * do SQLite, que `vi.setSystemTime` NÃO intercepta (o fake timer só troca o
 * `Date` do JS). Por isso os casos de janela gravam `created_at`
 * explicitamente, e a fidelidade do DEFAULT é verificada à parte, sem relógio
 * congelado.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { sql } from 'drizzle-orm';
import type { Database } from '$lib/db';
import { doisFatoresTokens, recoveryAttempts } from '$lib/server/schema';
import { timestampSqliteUtc, timestampSqliteBrasilia } from '../core';
import { bancoMigrado, drizzleSobre } from './sqlite-migrado';
import {
	contarRecoveryAttempts,
	registrarRecoveryAttempt
} from '$lib/server/auth/recovery-rate-limit';

const AGORA = Date.parse('2026-08-04T12:00:00.000Z');

let sqlite: DatabaseSync;
let db: Database;

beforeEach(() => {
	sqlite = bancoMigrado();
	db = drizzleSobre(sqlite);
});

describe('as duas convenções', () => {
	it('Brasília fica 3h atrás de UTC, no mesmo formato', () => {
		expect(timestampSqliteUtc(AGORA)).toBe('2026-08-04 12:00:00');
		expect(timestampSqliteBrasilia(AGORA)).toBe('2026-08-04 09:00:00');
	});

	it('nenhuma leva `T` nem `Z` — é isso que as torna comparáveis com a coluna', () => {
		for (const t of [timestampSqliteUtc(AGORA), timestampSqliteBrasilia(AGORA)]) {
			expect(t).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
		}
	});

	it('o DEFAULT de `dois_fatores_tokens` realmente grava Brasília', () => {
		// Sem relógio congelado de propósito: quem produz o valor é o SQLite.
		// Compara a coluna com o `datetime('now')` do próprio banco — 3h de
		// diferença é o que o `-3 hours` do schema promete.
		sqlite
			.prepare(
				`INSERT INTO dois_fatores_tokens (desafio_id, tipo, usuario_id, codigo, expires_at)
				 VALUES ('d', 'verificacao_email', 7, 'x', '2099-01-01T00:00:00.000Z')`
			)
			.run();
		const { gravado, utc } = sqlite
			.prepare("SELECT created_at AS gravado, datetime('now') AS utc FROM dois_fatores_tokens")
			.get() as { gravado: string; utc: string };

		expect(gravado).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
		const diffH = (Date.parse(utc + 'Z') - Date.parse(gravado + 'Z')) / 3_600_000;
		expect(diffH).toBeCloseTo(3, 1);
	});
});

describe('janela de rate limit sobre `dois_fatores_tokens.created_at`', () => {
	/** Grava `n` desafios com `created_at` no horário de Brasília pedido. */
	function inserirDesafios(n: number, emMs: number) {
		for (let i = 0; i < n; i++) {
			sqlite
				.prepare(
					`INSERT INTO dois_fatores_tokens (desafio_id, tipo, usuario_id, codigo, expires_at, created_at)
					 VALUES (?, 'verificacao_email', 7, 'x', '2099-01-01T00:00:00.000Z', ?)`
				)
				.run(`d${i}-${emMs}`, timestampSqliteBrasilia(emMs));
		}
	}

	async function contarDesde(limite: string): Promise<number> {
		const [r] = await db
			.select({ n: sql<number>`count(*)` })
			.from(doisFatoresTokens)
			.where(sql`${doisFatoresTokens.created_at} > ${limite}`);
		return Number(r?.n ?? 0);
	}

	it('conta os da janela quando o limite vem em horário de Brasília', async () => {
		inserirDesafios(3, AGORA - 60_000); // 1 min atrás
		await expect(contarDesde(timestampSqliteBrasilia(AGORA - 10 * 60_000))).resolves.toBe(3);
	});

	it('com `toISOString()` o contador dá ZERO — o limite não dispararia', async () => {
		// A implementação anterior dos três endpoints. Fica registrado como caso
		// para que a volta do `toISOString()` falhe aqui.
		inserirDesafios(3, AGORA - 60_000);
		await expect(contarDesde(new Date(AGORA - 10 * 60_000).toISOString())).resolves.toBe(0);
	});

	it('com o limite em UTC o formato acerta e o FUSO erra: janela 3h no futuro', async () => {
		// O segundo jeito de errar, e o motivo de existirem duas funções.
		inserirDesafios(3, AGORA - 60_000);
		await expect(contarDesde(timestampSqliteUtc(AGORA - 10 * 60_000))).resolves.toBe(0);
	});

	it('desafio FORA da janela não conta — ela realmente delimita', async () => {
		inserirDesafios(1, AGORA - 60_000); // dentro
		inserirDesafios(1, AGORA - 30 * 60_000); // fora

		await expect(contarDesde(timestampSqliteBrasilia(AGORA - 10 * 60_000))).resolves.toBe(1);
	});

	it('a virada do dia não salva o limite quebrado', async () => {
		// O `toISOString()` só passa a "funcionar" quando a data muda, o que
		// tornava o bug intermitente e difícil de acreditar.
		inserirDesafios(2, AGORA - 60_000);
		const isoOntem = new Date(AGORA - 26 * 3_600_000).toISOString();
		await expect(contarDesde(isoOntem)).resolves.toBe(2);
	});
});

describe('janela de rate limit sobre `recovery_attempts.attempted_at`', () => {
	it('o DEFAULT entra na janela quando o corte é sqlite UTC', async () => {
		await registrarRecoveryAttempt(db, '10.0.0.1', 'reauth_assinatura');
		const r = await contarRecoveryAttempts(db, '10.0.0.1', 'reauth_assinatura', 15, 5);
		expect(r.count).toBe(1);
		expect(r.blocked).toBe(false);
	});

	it('com `toISOString()` o contador dá ZERO — o limite não dispararia', async () => {
		// Relógio fixo: perto da meia-noite UTC a comparação lexicográfica de
		// `"YYYY-MM-DD HH:MM:SS"` com ISO (`T`/`Z`) pode CASUALMENTE contar a
		// linha (o dia muda e o bug "some"), o mesmo intermitente documentado
		// no caso da virada em `dois_fatores_tokens`. Grava `attempted_at` à
		// mão — `datetime('now')` do DEFAULT não respeita fake timer.
		sqlite
			.prepare(
				`INSERT INTO recovery_attempts (ip, purpose, attempted_at)
				 VALUES ('10.0.0.1', 'reauth_assinatura', ?)`
			)
			.run(timestampSqliteUtc(AGORA));
		const [row] = await db
			.select({ n: sql<number>`count(*)` })
			.from(recoveryAttempts)
			.where(
				sql`${recoveryAttempts.attempted_at} > ${new Date(AGORA - 15 * 60_000).toISOString()}`
			);
		expect(Number(row?.n ?? 0)).toBe(0);
	});
});
