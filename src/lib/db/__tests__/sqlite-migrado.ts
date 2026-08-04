/**
 * Banco SQLite real com TODAS as migrações aplicadas, para os testes que
 * precisam do SQL de verdade e não de um mock do query builder.
 *
 * É o caso sempre que o comportamento sob teste É o SQL: atomicidade de um
 * `UPDATE ... WHERE`, `ON CONFLICT DO UPDATE`, comparação lexicográfica de
 * datas em TEXT, `count`/`max` de um carimbo. Um fake do drizzle testaria a
 * FORMA da consulta — e já quebrou duas vezes neste projeto quando a consulta
 * mudou sem que o contrato mudasse.
 *
 * Rodar as migrações de verdade (em vez de um `CREATE TABLE` escrito à mão no
 * teste) é o que faz o teste enxergar CHECK constraints, defaults e índices
 * como produção os vê.
 *
 * Não é `*.test.ts` de propósito: é helper, e o guard de CI só exige que
 * ARQUIVOS DE TESTE morem em `__tests__/`.
 */
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/sqlite-proxy';
import type { Database } from '../core';

const DIR_MIGRACOES = join(process.cwd(), 'migrations');

/** SQLite em memória com o schema de produção, migração por migração. */
export function bancoMigrado(): DatabaseSync {
	const db = new DatabaseSync(':memory:');
	for (const arquivo of readdirSync(DIR_MIGRACOES)
		.filter((f) => f.endsWith('.sql'))
		.sort()) {
		const sql = readFileSync(join(DIR_MIGRACOES, arquivo), 'utf8');
		for (const stmt of sql.split('--> statement-breakpoint')) {
			const s = stmt.trim();
			if (s) db.exec(s);
		}
	}
	return db;
}

/**
 * Embrulha o `DatabaseSync` no `Database` que o código de produção espera.
 *
 * `sqlite-proxy` adapta qualquer driver: recebe SQL + params e devolve linhas
 * como array de arrays. O `rowsAffected` importa — sem ele, `.returning()` e
 * as contagens de expurgo leem zero e o teste passa de verde por engano.
 */
export function drizzleSobre(sqlite: DatabaseSync): Database {
	return drizzle(async (sql, params, method) => {
		const stmt = sqlite.prepare(sql);
		if (method === 'run') {
			const r = stmt.run(...(params as never[]));
			return { rows: [], rowsAffected: Number(r.changes ?? 0) } as never;
		}
		const linhas = stmt.all(...(params as never[])) as Record<string, unknown>[];
		const arrays = linhas.map((l) => Object.values(l));
		return { rows: method === 'get' ? (arrays[0] ?? []) : arrays };
	}) as unknown as Database;
}
