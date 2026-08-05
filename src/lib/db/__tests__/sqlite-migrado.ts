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

/** `setReturnArrays` existe a partir do Node 22.12; abaixo disso, caímos no objeto. */
type StatementComArrays = ReturnType<DatabaseSync['prepare']> & {
	setReturnArrays?: (v: boolean) => void;
};

/**
 * As linhas na ordem do `SELECT`, que é o que o `sqlite-proxy` consome.
 *
 * O caminho por objeto só sobrevive enquanto os nomes de coluna forem únicos —
 * e ele não tem como devolver o valor que a colisão já descartou. Então ele
 * ESTOURA em vez de devolver uma linha curta: um harness que erra em silêncio
 * custou mais tempo aqui do que qualquer bug de produção.
 */
function linhasComoArrays(stmt: StatementComArrays, params: unknown[]): unknown[][] {
	if (typeof stmt.setReturnArrays === 'function') {
		stmt.setReturnArrays(true);
		// Os tipos do `node:sqlite` ainda descrevem só o formato objeto.
		return stmt.all(...(params as never[])) as unknown as unknown[][];
	}

	const colunas = stmt.columns().map((c) => c.name);
	const linhas = stmt.all(...(params as never[])) as Record<string, unknown>[];
	return linhas.map((l) => {
		const valores = Object.values(l);
		if (valores.length !== colunas.length) {
			throw new Error(
				`Colunas repetidas no SELECT (${colunas.join(', ')}): o driver colapsou ` +
					`${colunas.length} em ${valores.length}. Dê um alias a uma delas — ` +
					'ou rode em Node >= 22.12, onde o harness pede arrays ao driver.'
			);
		}
		return valores;
	});
}

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
 * - **`meta.changes`** — a contagem de linhas afetadas, no MESMO lugar em que o
 *   D1 a devolve. Este harness já sintetizou um `rowsAffected` aqui, que é o
 *   nome do better-sqlite3 e que o D1 nunca produz: os quatro chamadores que
 *   decidiam por esse campo liam `undefined` em produção e todos os testes
 *   passavam. Ver `linhasAfetadas` em `db/core.ts`. O campo tem de se chamar
 *   como o do banco real, senão o teste mede o harness.
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
 *
 * O terceiro detalhe é `setReturnArrays`: sem ele, `stmt.all()` devolve OBJETOS
 * chaveados por nome de coluna, e um join que seleciona o mesmo nome de duas
 * tabelas (`administradores.primeiro_acesso` + `policiais.primeiro_acesso`)
 * colapsa numa chave só. `Object.values` então entrega menos colunas do que o
 * `SELECT` pediu, o drizzle mapeia deslocado, e o teste acusa um bug que só
 * existe no harness. Pedindo arrays ao driver a colisão deixa de ser possível.
 */
export function drizzleSobre(sqlite: DatabaseSync): Database {
	const executar = (sql: string, params: unknown[], method: string) => {
		const stmt = sqlite.prepare(sql);
		if (method === 'run') {
			const r = stmt.run(...(params as never[]));
			// `meta.changes` — o formato do D1. NÃO acrescente `rowsAffected`: foi
			// exatamente esse apelido inventado que deixou quatro chamadores lerem
			// `undefined` em produção com os testes verdes.
			return { rows: [], meta: { changes: Number(r.changes ?? 0) } };
		}
		const arrays = linhasComoArrays(stmt, params);
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
