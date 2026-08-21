/**
 * `escapeLike` só vale com `ESCAPE '\'` no SQL. Sem a cláusula, SQLite trata
 * `%`/`_` como wildcard mesmo depois da barra — a função documentava a
 * exigência e nenhum call site a cumpria (SEC-08).
 */
import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { escapeLike } from '../core';

describe('escapeLike + ESCAPE (SEC-08)', () => {
	it('com ESCAPE, 100% casa o literal e não 1000', () => {
		const sqlite = new DatabaseSync(':memory:');
		sqlite.exec(`CREATE TABLE t (n TEXT);
			INSERT INTO t VALUES ('100%'), ('1000'), ('100x'), ('prefixo 100% sufixo');`);
		const pattern = `%${escapeLike('100%')}%`;
		const comEscape = sqlite.prepare(`SELECT n FROM t WHERE n LIKE ? ESCAPE '\\'`).all(pattern) as {
			n: string;
		}[];
		expect(comEscape.map((r) => r.n).sort()).toEqual(['100%', 'prefixo 100% sufixo']);
	});

	it('sem ESCAPE, o % escapado continua sendo wildcard (o bug que o helper existia para fechar)', () => {
		const sqlite = new DatabaseSync(':memory:');
		sqlite.exec(`CREATE TABLE t (n TEXT);
			INSERT INTO t VALUES ('100%'), ('1000'), ('100x');`);
		const pattern = `%${escapeLike('100%')}%`;
		const semEscape = sqlite.prepare(`SELECT n FROM t WHERE n LIKE ?`).all(pattern) as {
			n: string;
		}[];
		// `\%` sem ESCAPE = barra literal + wildcard. Não casa '100%' (não tem barra)
		// e também não é a busca que o usuário pediu. Os dois lados estão errados.
		expect(semEscape.map((r) => r.n)).not.toEqual(['100%']);
	});
});
