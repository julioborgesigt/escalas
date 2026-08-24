/**
 * A janela `inicio`/`fim` de `listarTodasRespostasGise` — B-1.
 *
 * O painel de produtividade carregava o histórico INTEIRO da operação e o
 * cliente recortava; o servidor agora recorta pela janela e o default é o ano
 * corrente. Estes testes travam as duas propriedades que a troca introduziu:
 *
 *  - o recorte por intervalo é inclusivo nas DUAS bordas (o filtro da tela
 *    mostra "01/01 a 31/12", e o usuário conta com o dia 31);
 *  - a janela pode CRUZAR anos, que é o modo `personalizado` da tela — foi por
 *    isso que `ano` não serviu como parâmetro.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { bancoMigrado, drizzleSobre } from '../../__tests__/sqlite-migrado';
import { listarTodasRespostasGise } from '../respostas';
import type { Database } from '../../core';

let sqlite: DatabaseSync;
let db: Database;
let operacao: number;
let seccional: number;
let policial: number;

function ultimoId(): number {
	return Number((sqlite.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id);
}

/** Uma resposta numa GISE que começa em `data`. */
function respostaNoDia(data: string) {
	sqlite
		.prepare('INSERT INTO gise_escalas (data_inicio, operacao_id) VALUES (?, ?)')
		.run(data, operacao);
	const giseId = ultimoId();
	sqlite
		.prepare('INSERT INTO gise_seccionais (gise_id, seccional_id) VALUES (?, ?)')
		.run(giseId, seccional);
	const secId = ultimoId();
	sqlite
		.prepare('INSERT INTO gise_equipes (gise_seccional_id, gise_unidade_id, tipo) VALUES (?, ?, ?)')
		.run(secId, null, 'operacional');
	const equipeId = ultimoId();
	sqlite
		.prepare(
			'INSERT INTO gise_respostas_formulario (gise_id, policial_id, equipe_id, respostas) VALUES (?, ?, ?, ?)'
		)
		.run(giseId, policial, equipeId, '{}');
}

beforeEach(() => {
	sqlite = bancoMigrado();
	db = drizzleSobre(sqlite);
	sqlite.prepare("INSERT INTO unidades (nome, tipo) VALUES ('SEC JANELA', 'seccional')").run();
	seccional = ultimoId();
	// A operação GISE já vem semeada pelas migrations (0048+).
	operacao = (
		sqlite.prepare("SELECT id FROM operacoes WHERE nome = 'GISE'").get() as { id: number }
	).id;
	sqlite
		.prepare(
			"INSERT INTO policiais (matricula, nome, cargo, lotacao, senha, ativo) VALUES ('MJ1','J','DPC','SEC JANELA','h',1)"
		)
		.run();
	policial = ultimoId();
});

describe('janela inicio/fim (B-1)', () => {
	it('recorta ao intervalo e ignora o que está fora', async () => {
		respostaNoDia('2025-12-31');
		respostaNoDia('2026-06-15');
		respostaNoDia('2027-01-01');

		const r = await listarTodasRespostasGise(db, {
			inicio: '2026-01-01',
			fim: '2026-12-31',
			operacaoId: operacao
		});
		expect(r.total).toBe(1);
	});

	it('as duas bordas são INCLUSIVAS — o dia 31 conta', async () => {
		// A tela rotula "01/01 a 31/12"; borda exclusiva sumiria com o último dia
		// do ano sem erro nenhum, que é a classe de bug mais difícil de ver.
		respostaNoDia('2026-01-01');
		respostaNoDia('2026-12-31');

		const r = await listarTodasRespostasGise(db, {
			inicio: '2026-01-01',
			fim: '2026-12-31',
			operacaoId: operacao
		});
		expect(r.total).toBe(2);
	});

	it('a janela pode CRUZAR anos — é o modo personalizado da tela', async () => {
		// `ano` como parâmetro não expressaria isto: recortaria ao ano e o usuário
		// veria menos do que pediu, sem erro. Foi o motivo de trocar por intervalo.
		respostaNoDia('2025-11-20');
		respostaNoDia('2026-02-10');
		respostaNoDia('2026-09-01');

		const r = await listarTodasRespostasGise(db, {
			inicio: '2025-11-01',
			fim: '2026-03-31',
			operacaoId: operacao
		});
		expect(r.total).toBe(2);
	});

	it('sem janela, não há recorte por data', async () => {
		respostaNoDia('2020-01-01');
		respostaNoDia('2030-01-01');
		expect((await listarTodasRespostasGise(db, { operacaoId: operacao })).total).toBe(2);
	});

	it('só um dos lados deixa o outro aberto', async () => {
		respostaNoDia('2025-06-01');
		respostaNoDia('2026-06-01');
		expect(
			(await listarTodasRespostasGise(db, { inicio: '2026-01-01', operacaoId: operacao })).total
		).toBe(1);
		expect(
			(await listarTodasRespostasGise(db, { fim: '2025-12-31', operacaoId: operacao })).total
		).toBe(1);
	});
});
