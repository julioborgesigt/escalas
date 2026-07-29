/**
 * O `schema.ts` e a pasta `migrations/` descrevem a MESMA coisa e podem
 * divergir em silêncio. Este teste os confronta.
 *
 * Por que existe: `schema.ts` não cria tabela — editar lá só muda o tipo visto
 * pelo TypeScript. Uma coluna declarada no schema e ausente da migração compila,
 * passa no `check`, passa no lint, e só falha em runtime no primeiro SELECT. A
 * divergência inversa (coluna no banco e não no schema) é mais silenciosa
 * ainda: nada quebra, o dado simplesmente fica invisível para o código.
 *
 * O caso real que motivou o teste (jul/2026): a migração `0038` precisou
 * RECONSTRUIR `gise_assinaturas_relatorios` para trocar uma FK — SQLite não tem
 * `DROP CONSTRAINT` — e o `CREATE TABLE` foi copiado de `0000_initial_schema`.
 * Só que a tabela tinha ganhado 9 colunas depois (as 8 de metadado CAdES-LT da
 * `0012` e o `user_agent_raw` da `0025`). O rebuild dropou as nove. O sintoma
 * apareceu longe: INSERT de assinatura de relatório falhando no E2E. Este teste
 * teria acusado no `npm test`, em segundos.
 *
 * Como funciona: replica TODAS as migrações num SQLite em memória — a mesma
 * sequência que o D1 recebe — e compara, tabela a tabela, o conjunto de colunas
 * com o que o Drizzle declara. Não valida tipo nem constraint, só a EXISTÊNCIA
 * das colunas, que é a divergência que produz erro de runtime.
 */
import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getTableColumns, getTableName, is } from 'drizzle-orm';
import { SQLiteTable } from 'drizzle-orm/sqlite-core';
import * as schema from '../schema';

const DIR_MIGRACOES = join(process.cwd(), 'migrations');

/** Aplica todas as migrações, na ordem, num banco em memória. */
function bancoMigrado(): DatabaseSync {
	const db = new DatabaseSync(':memory:');
	const arquivos = readdirSync(DIR_MIGRACOES)
		.filter((f) => f.endsWith('.sql'))
		.sort();

	for (const arquivo of arquivos) {
		const sql = readFileSync(join(DIR_MIGRACOES, arquivo), 'utf8');
		// O separador é o mesmo que `scripts/migrate.ts` usa.
		for (const stmt of sql.split('--> statement-breakpoint')) {
			const s = stmt.trim();
			if (!s) continue;
			try {
				db.exec(s);
			} catch (e) {
				throw new Error(
					`migração ${arquivo} falhou ao replicar em SQLite: ${e instanceof Error ? e.message : String(e)}`
				);
			}
		}
	}
	return db;
}

/** Todas as tabelas declaradas no `schema.ts`, pelo nome real no banco. */
function tabelasDoSchema(): Array<{ nome: string; colunas: string[] }> {
	// O predicado é `unknown`, não `SQLiteTable`: os valores exportados são
	// tabelas com tipagem literal de colunas, e o supertipo genérico não é
	// atribuível a elas. `is()` já garante em runtime o que importa aqui.
	return (Object.values(schema) as unknown[])
		.filter((v): v is SQLiteTable => is(v, SQLiteTable))
		.map((t) => ({
			nome: getTableName(t),
			colunas: Object.values(getTableColumns(t))
				.map((c) => c.name)
				.sort()
		}));
}

describe('schema.ts × migrations/', () => {
	const db = bancoMigrado();
	const tabelas = tabelasDoSchema();

	it('replica todas as migrações sem erro', () => {
		// Coberto pelo `bancoMigrado()` acima, que lança em qualquer falha.
		expect(tabelas.length).toBeGreaterThan(10);
	});

	it.each(tabelas.map((t) => [t.nome, t] as const))(
		'`%s` tem no banco exatamente as colunas declaradas no schema',
		(_nome, tabela) => {
			const noBanco = (
				db.prepare(`PRAGMA table_info(${tabela.nome})`).all() as Array<{ name: string }>
			)
				.map((c) => c.name)
				.sort();

			expect(noBanco.length, `tabela "${tabela.nome}" não existe nas migrações`).toBeGreaterThan(0);

			const faltandoNoBanco = tabela.colunas.filter((c) => !noBanco.includes(c));
			const faltandoNoSchema = noBanco.filter((c) => !tabela.colunas.includes(c));

			expect(
				faltandoNoBanco,
				`colunas declaradas em schema.ts mas AUSENTES das migrações (falhariam no primeiro SELECT)`
			).toEqual([]);
			expect(
				faltandoNoSchema,
				`colunas existentes no banco mas NÃO declaradas em schema.ts (dado invisível ao código)`
			).toEqual([]);
		}
	);
});
