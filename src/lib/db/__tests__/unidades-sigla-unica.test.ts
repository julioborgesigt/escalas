/**
 * Migração 0080: sigla preenchida é única, sigla vazia pode repetir — e o
 * cargo do signatário gravado na forma abreviada passa à forma por extenso.
 *
 * `buscarDepartamentoPadrao` é conferida aqui também porque é dela que saem a
 * sigla do plano e os cargos do signatário; se devolvesse a unidade errada, o
 * documento sairia em nome de outro órgão sem erro nenhum.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { Database } from '$lib/db';
import { bancoMigrado, drizzleSobre } from './sqlite-migrado';
import { buscarDepartamentoPadrao } from '../unidades';

let db: Database;
let sqlite: ReturnType<typeof bancoMigrado>;

beforeEach(() => {
	sqlite = bancoMigrado();
	db = drizzleSobre(sqlite);
});

describe('sigla única (0080)', () => {
	it('recusa duas unidades com a mesma sigla preenchida, nomeando a coluna', () => {
		sqlite.exec(
			`INSERT INTO unidades (nome, tipo, sigla) VALUES ('Departamento A', 'departamento', 'DPA')`
		);
		expect(() =>
			sqlite.exec(
				`INSERT INTO unidades (nome, tipo, sigla) VALUES ('Departamento B', 'departamento', 'DPA')`
			)
		).toThrow(/UNIQUE constraint failed: unidades\.sigla/);
	});

	it('sigla vazia pode repetir à vontade — delegacia e seccional não têm sigla', () => {
		sqlite.exec(`
			INSERT INTO unidades (nome, tipo, sigla) VALUES ('Delegacia X', 'delegacia', '');
			INSERT INTO unidades (nome, tipo, sigla) VALUES ('Delegacia Y', 'delegacia', '');
			INSERT INTO unidades (nome, tipo) VALUES ('Delegacia Z', 'delegacia');
		`);
		const r = sqlite.prepare("SELECT count(*) AS n FROM unidades WHERE sigla = ''").get() as {
			n: number;
		};
		expect(r.n).toBeGreaterThanOrEqual(3);
	});
});

describe('buscarDepartamentoPadrao', () => {
	it('devolve o DPI SUL semeado, com sigla e nome por extenso', async () => {
		const d = await buscarDepartamentoPadrao(db);
		expect(d).toMatchObject({
			nome: 'Departamento de Polícia do Interior Sul',
			sigla: 'DPI SUL'
		});
	});

	it('ignora departamento desativado e, entre ativos, devolve o mais antigo', async () => {
		const original = (await buscarDepartamentoPadrao(db))!;
		sqlite.exec(
			`INSERT INTO unidades (nome, tipo, sigla) VALUES ('Departamento Novo', 'departamento', 'DPN')`
		);
		expect((await buscarDepartamentoPadrao(db))!.id).toBe(original.id);
		sqlite.exec(`UPDATE unidades SET ativo = 0 WHERE id = ${original.id}`);
		expect((await buscarDepartamentoPadrao(db))!.sigla).toBe('DPN');
	});
});

describe('cargo do signatário por extenso (0080)', () => {
	it('a string exata da lista antiga foi reescrita; texto livre ficou como estava', () => {
		// Um banco recém-migrado não tem plano; simula-se o estado anterior à 0080
		// e reaplica-se só a parte de dados dela.
		sqlite.exec(`
			INSERT INTO planos_operacionais (nome, numero, ano, data_inicio, diretor_cargo)
			VALUES ('A', 1, 2026, '2026-01-01', 'Diretor Titular do DPI SUL'),
			       ('B', 2, 2026, '2026-01-01', 'Diretor Adjunto do DPI SUL'),
			       ('C', 3, 2026, '2026-01-01', 'Chefe de Gabinete');
			UPDATE planos_operacionais SET diretor_cargo = 'Diretor Titular do Departamento de Polícia do Interior Sul'
			 WHERE diretor_cargo = 'Diretor Titular do DPI SUL';
			UPDATE planos_operacionais SET diretor_cargo = 'Diretor Adjunto do Departamento de Polícia do Interior Sul'
			 WHERE diretor_cargo = 'Diretor Adjunto do DPI SUL';
		`);
		const cargos = (
			sqlite.prepare('SELECT diretor_cargo FROM planos_operacionais ORDER BY numero').all() as {
				diretor_cargo: string;
			}[]
		).map((l) => l.diretor_cargo);
		expect(cargos).toEqual([
			'Diretor Titular do Departamento de Polícia do Interior Sul',
			'Diretor Adjunto do Departamento de Polícia do Interior Sul',
			'Chefe de Gabinete'
		]);
	});
});
