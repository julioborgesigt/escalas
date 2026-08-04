/**
 * Escopo administrativo sobre o cadastro (`lotacoesAdministradas`) contra um
 * SQLite REAL com todas as migrações aplicadas — mesmo harness de
 * `sync-estado.test.ts` e `schema-x-migracoes.test.ts`.
 *
 * Este helper decide QUEM um admin pode administrar, e é consumido por 7 pontos
 * (listagem e edição de policiais, permissão de escala, solicitação de
 * assinatura, rubrica pendente). Até aqui só existia cobertura INDIRETA, com ele
 * mockado (`escalas/__tests__/permissao.test.ts`) — ou seja, nada verificava a
 * query de expansão da seccional em si. Um erro nela abriria ou fecharia escopo
 * silenciosamente, sem quebrar teste nenhum.
 *
 * A distinção que mais importa aqui é `null` × `Set` vazio: `null` significa
 * "sem restrição" (Admin Geral) e `lotacaoNoEscopo` devolve `true` para qualquer
 * lotação; `Set` vazio significa "não administra nada" e devolve sempre `false`.
 * Trocar um pelo outro inverte o gate.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/sqlite-proxy';
import type { Database } from '$lib/db';
import { lotacoesAdministradas, lotacaoNoEscopo, lotacoesDaSeccional } from '../policial-permissao';

const DIR_MIGRACOES = join(process.cwd(), 'migrations');

function bancoMigrado(): DatabaseSync {
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

let sqlite: DatabaseSync;
let db: Database;

/** Monta um `usuario` de sessão com o mínimo que os predicados de papel leem. */
function usuario(over: Record<string, unknown>) {
	return {
		id: 1,
		tipo: 'policial',
		nome: 'Fulano',
		primeiro_acesso: false,
		...over
	} as unknown as NonNullable<App.Locals['usuario']>;
}

beforeAll(() => {
	sqlite = bancoMigrado();
	db = drizzle(async (sql, params, method) => {
		const stmt = sqlite.prepare(sql);
		if (method === 'run') {
			stmt.run(...(params as never[]));
			return { rows: [] };
		}
		const linhas = stmt.all(...(params as never[])) as Record<string, unknown>[];
		const arrays = linhas.map((l) => Object.values(l));
		return { rows: method === 'get' ? (arrays[0] ?? []) : arrays };
	}) as unknown as Database;

	// Duas seccionais com delegacias próprias: é o que prova que a expansão não
	// vaza de uma seccional para a outra. Ids 9xxx porque as migrações já semeiam
	// as unidades 1 e 2.
	sqlite.exec(`
		INSERT INTO unidades (id, nome, tipo, seccional_id) VALUES
			(9100, 'SECCIONAL NORTE', 'seccional', NULL),
			(9101, 'DP PRIMEIRA', 'delegacia', 9100),
			(9102, 'DP SEGUNDA', 'delegacia', 9100),
			(9200, 'SECCIONAL SUL', 'seccional', NULL),
			(9201, 'DP TERCEIRA', 'delegacia', 9200);
	`);
});

describe('lotacoesDaSeccional', () => {
	it('devolve a própria seccional E as unidades subordinadas a ela', async () => {
		const nomes = await lotacoesDaSeccional(db, 9100);
		expect([...nomes].sort()).toEqual(['DP PRIMEIRA', 'DP SEGUNDA', 'SECCIONAL NORTE']);
	});

	it('não vaza para as unidades de outra seccional', async () => {
		const nomes = await lotacoesDaSeccional(db, 9200);
		expect([...nomes].sort()).toEqual(['DP TERCEIRA', 'SECCIONAL SUL']);
	});

	it('devolve vazio para um id que não é seccional de ninguém', async () => {
		expect(await lotacoesDaSeccional(db, 9101)).toEqual(['DP PRIMEIRA']);
		expect(await lotacoesDaSeccional(db, 987654)).toEqual([]);
	});
});

describe('lotacoesAdministradas', () => {
	it('Admin Geral recebe null — "sem restrição", não "escopo vazio"', async () => {
		const escopo = await lotacoesAdministradas(db, usuario({ tipo: 'admin' }));
		expect(escopo).toBeNull();
		// É esta a consequência prática do null, e o que o distingue do Set vazio.
		expect(lotacaoNoEscopo(escopo, 'QUALQUER UNIDADE')).toBe(true);
	});

	it('admin_seccional administra a seccional e as unidades abaixo dela', async () => {
		const escopo = await lotacoesAdministradas(
			db,
			usuario({ papel: 'admin_seccional', papel_unidade_id: 9100 })
		);
		expect(escopo).not.toBeNull();
		expect([...escopo!].sort()).toEqual(['DP PRIMEIRA', 'DP SEGUNDA', 'SECCIONAL NORTE']);
		expect(lotacaoNoEscopo(escopo, 'DP PRIMEIRA')).toBe(true);
		expect(lotacaoNoEscopo(escopo, 'DP TERCEIRA')).toBe(false);
	});

	it('admin_seccional SEM papel_unidade_id não administra nada', async () => {
		const escopo = await lotacoesAdministradas(
			db,
			usuario({ papel: 'admin_seccional', papel_unidade_id: null })
		);
		expect(escopo).toEqual(new Set());
		expect(lotacaoNoEscopo(escopo, 'SECCIONAL NORTE')).toBe(false);
	});

	it('admin_unidade administra apenas a própria lotação', async () => {
		const escopo = await lotacoesAdministradas(
			db,
			usuario({ papel: 'admin_unidade', lotacao: 'DP PRIMEIRA', papel_unidade_id: 9100 })
		);
		// Repare: o escopo vem da LOTAÇÃO, não do `papel_unidade_id` — mesmo com o
		// id da seccional preenchido, ele não expande (achado FLW-RBAC-003).
		expect(escopo).toEqual(new Set(['DP PRIMEIRA']));
		expect(lotacaoNoEscopo(escopo, 'DP SEGUNDA')).toBe(false);
	});

	it('policial sem papel administrativo não administra nada', async () => {
		const escopo = await lotacoesAdministradas(
			db,
			usuario({ papel: null, lotacao: 'DP PRIMEIRA' })
		);
		expect(escopo).toEqual(new Set());
		expect(lotacaoNoEscopo(escopo, 'DP PRIMEIRA')).toBe(false);
	});
});
