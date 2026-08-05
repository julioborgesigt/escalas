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
 * como array de arrays. Dois detalhes do contrato do driver decidem se o teste
 * mede o que promete:
 *
 * - **`rowsAffected`** — sem ele, `.returning()` e as contagens de expurgo leem
 *   zero e o teste passa de verde por engano.
 * - **`rows` de um `get` sem resultado tem de ser `undefined`, não `[]`.** O
 *   `mapGetResult` do drizzle decide "não achou" por FALSY (`if (!row) return
 *   undefined`). Devolvendo `[]`, que é truthy, ele mapeia a linha vazia e
 *   entrega `{ id: undefined, ... }` — um objeto. Todo `if (!row) return
 *   notFound()` do código de produção tomava o caminho ERRADO só nos testes, e
 *   em silêncio: o D1 real devolve `undefined`.
 *
 * O `batch` roda dentro de uma TRANSAÇÃO do SQLite — é o que o D1 faz, e é a
 * propriedade que o código de produção usa quando escolhe `batch` em vez de
 * chamadas em sequência. Sem isso, um teste de atomicidade mediria uma
 * sequência disfarçada de transação e passaria com o código não atômico.
 */
export function drizzleSobre(sqlite: DatabaseSync): Database {
	const executar = (sql: string, params: unknown[], method: string) => {
		const stmt = sqlite.prepare(sql);
		if (method === 'run') {
			const r = stmt.run(...(params as never[]));
			return { rows: [], rowsAffected: Number(r.changes ?? 0) };
		}
		const linhas = stmt.all(...(params as never[])) as Record<string, unknown>[];
		const arrays = linhas.map((l) => Object.values(l));
		return { rows: method === 'get' ? (arrays[0] as never) : arrays };
	};

	return drizzle(
		async (sql, params, method) => executar(sql, params, method) as never,
		async (queries) => {
			sqlite.exec('BEGIN');
			try {
				const r = queries.map((q) => executar(q.sql, q.params, q.method));
				sqlite.exec('COMMIT');
				return r as never;
			} catch (err) {
				sqlite.exec('ROLLBACK');
				throw err;
			}
		}
	) as unknown as Database;
}
