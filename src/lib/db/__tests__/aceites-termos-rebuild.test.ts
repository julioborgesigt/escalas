/**
 * Migração 0081 — a reconstrução de `aceites_termos`.
 *
 * É a única reconstrução de tabela do módulo de diárias, e a tabela guarda
 * registro de conformidade (a manifestação de aceite de cada pessoa). O que se
 * confere aqui é o que uma reconstrução pode perder em silêncio: coluna
 * acrescentada depois da criação (são 13 no total), linha, valor, índice e a
 * sequência do AUTOINCREMENT. E o objetivo dela: `colaborador` passa no CHECK,
 * valor inventado continua não passando.
 *
 * O helper `bancoMigrado` aplica tudo de uma vez; aqui a aplicação é em duas
 * etapas para haver linhas ANTES da reconstrução.
 */
import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(process.cwd(), 'migrations');
const REBUILD = '0081_aceites_termos_colaborador.sql';

function aplicar(db: DatabaseSync, filtro: (arquivo: string) => boolean) {
	for (const arquivo of readdirSync(DIR)
		.filter((f) => f.endsWith('.sql') && filtro(f))
		.sort()) {
		for (const stmt of readFileSync(join(DIR, arquivo), 'utf8').split('--> statement-breakpoint')) {
			const s = stmt.trim();
			if (s) db.exec(s);
		}
	}
}

const COLUNAS = [
	'id',
	'usuario_tipo',
	'usuario_id',
	'versao_termo',
	'hash_termo',
	'aceitou_lgpd',
	'ip',
	'user_agent',
	'aceitou_em',
	'aceitou_uso_email',
	'aceitou_uso_localizacao',
	'conteudo_html_snapshot',
	'aceitou_assinatura_avancada'
];

function colunas(db: DatabaseSync): string[] {
	return (
		db.prepare("SELECT name FROM pragma_table_info('aceites_termos')").all() as { name: string }[]
	).map((c) => c.name);
}

describe('reconstrução de aceites_termos (0081)', () => {
	it('preserva as 13 colunas, as linhas, os valores, o índice e a sequência', () => {
		const db = new DatabaseSync(':memory:');
		aplicar(db, (f) => f < REBUILD);
		expect(colunas(db)).toEqual(COLUNAS);

		db.exec(`
			INSERT INTO aceites_termos (usuario_tipo, usuario_id, versao_termo, hash_termo, aceitou_lgpd,
			  ip, user_agent, aceitou_uso_email, aceitou_uso_localizacao, conteudo_html_snapshot, aceitou_assinatura_avancada)
			VALUES ('policial', 7, '2.0', 'abc', 1, '10.0.0.0', 'Chrome', 1, 0, '<p>termo</p>', 1),
			       ('admin', 3, '2.0', 'abc', 1, NULL, NULL, 0, 0, NULL, 0);
		`);
		const antes = db.prepare('SELECT * FROM aceites_termos ORDER BY id').all();
		expect(antes).toHaveLength(2);

		aplicar(db, (f) => f >= REBUILD);

		expect(colunas(db)).toEqual(COLUNAS);
		const depois = db.prepare('SELECT * FROM aceites_termos ORDER BY id').all();
		expect(depois).toEqual(antes);

		const indices = (
			db
				.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='aceites_termos'")
				.all() as {
				name: string;
			}[]
		).map((i) => i.name);
		expect(indices).toContain('idx_aceites_termos_usuario');

		// A sequência continua de onde estava: o próximo id é 3, não 1.
		db.exec(
			`INSERT INTO aceites_termos (usuario_tipo, usuario_id, versao_termo, hash_termo) VALUES ('policial', 8, '2.0', 'abc')`
		);
		const ultimo = db.prepare('SELECT max(id) AS id FROM aceites_termos').get() as { id: number };
		expect(ultimo.id).toBe(3);
	});

	it('admite colaborador e continua recusando tipo inventado', () => {
		const db = new DatabaseSync(':memory:');
		aplicar(db, () => true);
		expect(() =>
			db.exec(
				`INSERT INTO aceites_termos (usuario_tipo, usuario_id, versao_termo, hash_termo) VALUES ('colaborador', 1, '2.0', 'abc')`
			)
		).not.toThrow();
		expect(() =>
			db.exec(
				`INSERT INTO aceites_termos (usuario_tipo, usuario_id, versao_termo, hash_termo) VALUES ('visitante', 1, '2.0', 'abc')`
			)
		).toThrow(/CHECK constraint failed/);
	});
});
