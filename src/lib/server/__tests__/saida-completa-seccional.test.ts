/**
 * As condições de presença que movem a máquina de estados da GISE, contra um
 * SQLite REAL com todas as migrações.
 *
 * A versão anterior mockava o query builder do Drizzle (`select().from()...`
 * devolvendo um objeto encadeável), o que prendia o teste à FORMA da query: ele
 * quebrava ao trocar um `.all()` por um `count()` agregado, mesmo com o
 * resultado idêntico, e — pior — passaria se a query mudasse de coluna, porque
 * o mock devolvia o valor combinado independentemente do que fosse pedido.
 *
 * Com banco de verdade o que se prende é o CONTRATO: dado quem está escalado e
 * quem marcou presença, a GISE pode ou não avançar. É o que importa aqui —
 * `verificarSaidaCompletaSeccional` é o portão do relatório de serviço
 * extraordinário, e o quadro de supervisão não pertence a equipe nenhuma, então
 * contar linhas de presença em vez de pessoas daria "todos presentes" para uma
 * supervisão que nunca apareceu.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/sqlite-proxy';
import type { Database } from '$lib/db';
import { verificarSaidaCompletaSeccional } from '../../db/gise/escalas-status';

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

const GISE = 100;
const SECCIONAL = 9002;

beforeEach(() => {
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

	// Uma GISE com supervisor (1) e assessor (2) no quadro, e dois membros
	// escalados (10 e 11) numa equipe da seccional.
	sqlite.exec(`
		INSERT INTO unidades (id, nome, tipo) VALUES (${SECCIONAL}, 'SEC TESTE', 'seccional');
		INSERT INTO policiais (id, matricula, nome, cargo, lotacao, senha, ativo) VALUES
			(1, 'M1', 'Supervisor', 'DPC', 'SEC TESTE', 'x', 1),
			(2, 'M2', 'Assessor', 'DPC', 'SEC TESTE', 'x', 1),
			(10, 'M10', 'Membro Um', 'OIP', 'SEC TESTE', 'x', 1),
			(11, 'M11', 'Membro Dois', 'OIP', 'SEC TESTE', 'x', 1);
		INSERT INTO gise_escalas (id, data_inicio, status, hora_entrada, hora_saida, supervisor_id, assessor_id)
			VALUES (${GISE}, '2026-05-01', 'aguardando_relatorios', '08:00', '16:00', 1, 2);
		INSERT INTO gise_seccionais (id, gise_id, seccional_id, status) VALUES (200, ${GISE}, ${SECCIONAL}, 'preenchida');
		INSERT INTO gise_equipes (id, gise_seccional_id, tipo, slots_dpc, slots_oip) VALUES (300, 200, 'operacional', 0, 2);
		INSERT INTO gise_membros (id, equipe_id, policial_id) VALUES (400, 300, 10), (401, 300, 11);
	`);
});

/** Marca presença; `saida = null` representa quem entrou mas não saiu. */
function presenca(policialId: number, saida: string | null) {
	sqlite.exec(
		`INSERT INTO gise_presencas (gise_id, policial_id, entrada_timestamp, saida_timestamp)
		 VALUES (${GISE}, ${policialId}, '2026-05-01 08:00:00', ${saida ? `'${saida}'` : 'NULL'})`
	);
}

describe('verificarSaidaCompletaSeccional — seccional', () => {
	it('todos os membros com saída → true', async () => {
		presenca(10, '2026-05-01 16:00:00');
		presenca(11, '2026-05-01 16:00:00');
		expect(await verificarSaidaCompletaSeccional(db, GISE, SECCIONAL, false)).toBe(true);
	});

	it('um membro entrou mas não saiu → false', async () => {
		presenca(10, '2026-05-01 16:00:00');
		presenca(11, null);
		expect(await verificarSaidaCompletaSeccional(db, GISE, SECCIONAL, false)).toBe(false);
	});

	it('membro SEM linha de presença nenhuma também bloqueia', async () => {
		presenca(10, '2026-05-01 16:00:00');
		expect(await verificarSaidaCompletaSeccional(db, GISE, SECCIONAL, false)).toBe(false);
	});

	it('seccional sem membros → false (vazio não é "todos saíram")', async () => {
		sqlite.exec(`DELETE FROM gise_membros`);
		expect(await verificarSaidaCompletaSeccional(db, GISE, SECCIONAL, false)).toBe(false);
	});

	it('não conta membro de OUTRA seccional', async () => {
		sqlite.exec(`
			INSERT INTO unidades (id, nome, tipo) VALUES (9003, 'SEC OUTRA', 'seccional');
			INSERT INTO gise_seccionais (id, gise_id, seccional_id, status) VALUES (201, ${GISE}, 9003, 'preenchida');
			INSERT INTO gise_equipes (id, gise_seccional_id, tipo, slots_dpc, slots_oip) VALUES (301, 201, 'operacional', 0, 1);
			INSERT INTO gise_membros (id, equipe_id, policial_id) VALUES (402, 301, 1);
		`);
		presenca(10, '2026-05-01 16:00:00');
		presenca(11, '2026-05-01 16:00:00');
		// O membro da outra seccional não marcou saída, mas não pertence a esta.
		expect(await verificarSaidaCompletaSeccional(db, GISE, SECCIONAL, false)).toBe(true);
	});
});

describe('verificarSaidaCompletaSeccional — quadro de supervisão', () => {
	it('todo o quadro saiu → true', async () => {
		presenca(1, '2026-05-01 16:00:00');
		presenca(2, '2026-05-01 16:00:00');
		expect(await verificarSaidaCompletaSeccional(db, GISE, 999, true)).toBe(true);
	});

	it('um do quadro entrou mas não saiu → false', async () => {
		presenca(1, '2026-05-01 16:00:00');
		presenca(2, null);
		expect(await verificarSaidaCompletaSeccional(db, GISE, 999, true)).toBe(false);
	});

	it('supervisor sem linha de presença bloqueia — conta PESSOAS, não linhas', async () => {
		// O caso que uma contagem de linhas erraria: só o assessor apareceu, e
		// `count(linhas com saída) >= count(linhas)` daria "todos presentes".
		presenca(2, '2026-05-01 16:00:00');
		expect(await verificarSaidaCompletaSeccional(db, GISE, 999, true)).toBe(false);
	});

	it('GISE sem quadro definido → false', async () => {
		sqlite.exec(
			`UPDATE gise_escalas SET supervisor_id = NULL, assessor_id = NULL WHERE id = ${GISE}`
		);
		expect(await verificarSaidaCompletaSeccional(db, GISE, 999, true)).toBe(false);
	});
});
