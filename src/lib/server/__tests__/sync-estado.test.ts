/**
 * Carimbos de `/api/sync/estado` contra um SQLite REAL, com todas as migrações
 * aplicadas (mesmo harness de `schema-x-migracoes`).
 *
 * O contrato de um carimbo é uma propriedade, não um formato: **muda quando o
 * dado que a tela mostra muda, e não muda quando nada muda**. Um fake de `db`
 * testaria só a concatenação da string — passaria de verde com uma query que
 * ignora a coluna errada. Por isso aqui o banco é de verdade: cada caso grava
 * uma alteração e compara o antes com o depois.
 *
 * Os dois lados importam igualmente:
 * - carimbo que NÃO muda quando deveria → a tela fica desatualizada em silêncio,
 *   que é exatamente o bug que este mecanismo existe para resolver;
 * - carimbo que muda à toa → o poll re-roda o `load` pesado a cada tick,
 *   anulando o ganho de ter um endpoint leve.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/sqlite-proxy';
import type { Database } from '$lib/db';
import {
	carimboGise,
	carimboEscala,
	carimboGiseList,
	carimboPainel,
	carimboResGise,
	resumoRecebidosAdmin
} from '../sync-estado';

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

/** Executa SQL direto — é assim que os testes provocam a mudança. */
function exec(sql: string) {
	sqlite.exec(sql);
}

beforeAll(() => {
	sqlite = bancoMigrado();
	// `sqlite-proxy` adapta qualquer driver: recebe SQL + params e devolve
	// linhas como array de arrays, que é o formato que o drizzle espera.
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

	// Base mínima: uma unidade, dois policiais, uma GISE completa e uma escala.
	// Ids na faixa 9xxx: as migrações já semeiam `unidades` 1 e 2 (a unidade
	// sintética do extra da supervisão e a seccional padrão).
	exec(`
		INSERT INTO unidades (id, nome, tipo) VALUES (9001, 'DP TESTE', 'delegacia'), (9002, 'SEC TESTE', 'seccional');
		INSERT INTO policiais (id, matricula, nome, cargo, lotacao, senha, ativo)
			VALUES (10, 'M10', 'Policial Dez', 'OIP', 'DP TESTE', 'x', 1),
			       (11, 'M11', 'Policial Onze', 'DPC', 'DP TESTE', 'x', 1);
		INSERT INTO gise_escalas (id, data_inicio, status, hora_entrada, hora_saida, supervisor_id)
			VALUES (100, '2026-05-01', 'em_andamento', '08:00', '16:00', 11);
		INSERT INTO gise_seccionais (id, gise_id, seccional_id, status) VALUES (200, 100, 9002, 'preenchida');
		INSERT INTO gise_equipes (id, gise_seccional_id, tipo, slots_dpc, slots_oip) VALUES (300, 200, 'operacional', 1, 4);
		INSERT INTO gise_membros (id, equipe_id, policial_id) VALUES (400, 300, 10);
		INSERT INTO escalas (id, titulo, cidade, tipo, lotacao, data_inicio, data_fim)
			VALUES (500, 'Escala Teste', 'Fortaleza', 'plantao', 'DP TESTE', '2026-05-01', '2026-05-31');
		INSERT INTO escala_policiais (id, escala_id, policial_id, data_plantao, hora_entrada, hora_saida, equipe)
			VALUES (600, 500, 10, '2026-05-01', '08:00', '20:00', '1');
	`);
});

/** Roda o carimbo, aplica a mudança e roda de novo. */
async function aoRedorDe(
	carimbo: () => Promise<string | null>,
	mudanca: string
): Promise<{ antes: string | null; depois: string | null }> {
	const antes = await carimbo();
	exec(mudanca);
	return { antes, depois: await carimbo() };
}

describe('carimboGise', () => {
	const alvo = () => carimboGise(db, 100);

	it('devolve null para GISE inexistente', async () => {
		expect(await carimboGise(db, 999)).toBeNull();
	});

	it('é estável quando nada muda', async () => {
		expect(await alvo()).toBe(await alvo());
	});

	it.each([
		['status da GISE', `UPDATE gise_escalas SET status = 'aguardando_relatorios' WHERE id = 100`],
		['horário da GISE', `UPDATE gise_escalas SET hora_saida = '18:00' WHERE id = 100`],
		['quadro de supervisão', `UPDATE gise_escalas SET assessor_id = 11 WHERE id = 100`],
		[
			'breve relatório',
			`UPDATE gise_escalas SET breve_relatorio_texto_seccional = 'texto' WHERE id = 100`
		],
		['status da seccional', `UPDATE gise_seccionais SET status = 'assinada' WHERE id = 200`],
		['slots da equipe', `UPDATE gise_equipes SET slots_oip = 6 WHERE id = 300`],
		[
			'entrada de membro',
			`INSERT INTO gise_membros (id, equipe_id, policial_id) VALUES (401, 300, 11)`
		],
		[
			'presença registrada',
			`INSERT INTO gise_presencas (id, gise_id, policial_id, entrada_timestamp) VALUES (700, 100, 10, '2026-05-01 08:00:00')`
		],
		[
			'relatório de produtividade enviado',
			`INSERT INTO gise_respostas_formulario (id, gise_id, policial_id, equipe_id, respostas) VALUES (800, 100, 10, 300, '{}')`
		]
	])('muda quando muda %s', async (_rotulo, mudanca) => {
		const { antes, depois } = await aoRedorDe(alvo, mudanca);
		expect(depois).not.toBe(antes);
	});

	it('não muda com alteração em OUTRA GISE', async () => {
		exec(
			`INSERT INTO gise_escalas (id, data_inicio, status, hora_entrada, hora_saida, supervisor_id) VALUES (101, '2026-06-01', 'em_andamento', '08:00', '16:00', 11)`
		);
		const antes = await alvo();
		exec(`UPDATE gise_escalas SET status = 'finalizada' WHERE id = 101`);
		expect(await alvo()).toBe(antes);
	});
});

describe('carimboEscala', () => {
	const alvo = () => carimboEscala(db, 500);

	it('devolve null para escala inexistente', async () => {
		expect(await carimboEscala(db, 999)).toBeNull();
	});

	it('é estável quando nada muda', async () => {
		expect(await alvo()).toBe(await alvo());
	});

	it.each([
		['período', `UPDATE escalas SET data_fim = '2026-06-30' WHERE id = 500`],
		[
			'escalado adicionado',
			`INSERT INTO escala_policiais (id, escala_id, policial_id, data_plantao, hora_entrada, hora_saida, equipe) VALUES (601, 500, 11, '2026-05-02', '08:00', '20:00', '2')`
		],
		['horário do escalado', `UPDATE escala_policiais SET hora_saida = '19:00' WHERE id = 600`]
	])('muda quando muda %s', async (_rotulo, mudanca) => {
		const { antes, depois } = await aoRedorDe(alvo, mudanca);
		expect(depois).not.toBe(antes);
	});
});

describe('carimboGiseList', () => {
	it('muda quando entra uma GISE nova', async () => {
		const { antes, depois } = await aoRedorDe(
			() => carimboGiseList(db),
			`INSERT INTO gise_escalas (id, data_inicio, status, hora_entrada, hora_saida, supervisor_id) VALUES (102, '2026-07-01', 'em_definicao_supervisor', '08:00', '16:00', 11)`
		);
		expect(depois).not.toBe(antes);
	});

	it('muda quando o status de uma GISE muda', async () => {
		const { antes, depois } = await aoRedorDe(
			() => carimboGiseList(db),
			`UPDATE gise_escalas SET status = 'finalizada' WHERE id = 102`
		);
		expect(depois).not.toBe(antes);
	});
});

describe('carimboResGise', () => {
	it('é estável quando nada muda', async () => {
		expect(await carimboResGise(db, 10)).toBe(await carimboResGise(db, 10));
	});

	it('muda quando a presença do policial muda', async () => {
		// `updated_at` vai junto porque é o que `salvarSaidaGise` faz — ver o teste
		// seguinte, que é o motivo de isto não ser um detalhe.
		const { antes, depois } = await aoRedorDe(
			async () => carimboResGise(db, 10),
			`UPDATE gise_presencas SET saida_timestamp = '2026-05-01 16:00:00', updated_at = '2026-05-01 16:00:01' WHERE id = 700`
		);
		expect(depois).not.toBe(antes);
	});

	/**
	 * ARMADILHA, não curiosidade: este carimbo observa `count` + `max(updated_at)`,
	 * e não o conteúdo das colunas. Uma escrita futura em `gise_presencas` que
	 * esqueça de tocar `updated_at` fica INVISÍVEL para o poll — a tela do policial
	 * não atualiza e nada acusa. Hoje `salvarEntradaGise`/`salvarSaidaGise` setam
	 * o campo à mão (a coluna não tem trigger de `ON UPDATE`); quem escrever a
	 * próxima função de presença precisa fazer o mesmo.
	 */
	it('escrita que NÃO atualiza `updated_at` fica invisível ao carimbo', async () => {
		const antes = await carimboResGise(db, 10);
		exec(`UPDATE gise_presencas SET latitude = -3.7 WHERE id = 700`);
		expect(await carimboResGise(db, 10)).toBe(antes);
	});
});

describe('carimboPainel e resumoRecebidosAdmin', () => {
	it('o painel é estável quando nada muda', async () => {
		expect(await carimboPainel(db)).toBe(await carimboPainel(db));
	});

	it('recebidos conta os NÃO vistos e o carimbo acompanha', async () => {
		exec(
			`INSERT INTO escala_documentos (id, escala_id, r2_key, assinante_nome, verificacao_hash) VALUES (900, 500, 'k', 'A', 'h')`
		);
		const antes = await resumoRecebidosAdmin(db);
		expect(antes.naoVistos).toBe(1);

		exec(`UPDATE escalas SET visto_por_admin = 1 WHERE id = 500`);
		const depois = await resumoRecebidosAdmin(db);
		expect(depois.naoVistos).toBe(0);
		expect(depois.stamp).not.toBe(antes.stamp);
	});
});
