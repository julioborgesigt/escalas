/**
 * `totalConhecido` de `listarTodasRespostasGise` — o `count(*)` que o painel de
 * produtividade pagava uma vez por página.
 *
 * O painel lê a página 1, descobre `totalPages` e busca as demais em paralelo.
 * Cada uma refazia a contagem sobre a mesma junção de cinco tabelas para chegar
 * ao número que a página 1 já tinha devolvido.
 *
 * O que estes testes travam são as duas metades do contrato, e a segunda é a
 * que protege contra uma "otimização" que quebrasse a paginação:
 *
 *  - passar `totalConhecido` NÃO muda as linhas devolvidas — quem recorta é o
 *    `WHERE`, e a contagem nunca participou disso;
 *  - passar `totalConhecido` de fato PULA a contagem. Provado sem espiar a
 *    implementação: passa-se um total que não corresponde à realidade e
 *    verifica-se que ele sai no `total`/`totalPages`. Se a query ainda rodasse,
 *    o número real teria vencido.
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
	sqlite.prepare("INSERT INTO unidades (nome, tipo) VALUES ('SEC TOTAL', 'seccional')").run();
	seccional = ultimoId();
	operacao = (
		sqlite.prepare("SELECT id FROM operacoes WHERE nome = 'GISE'").get() as { id: number }
	).id;
	sqlite
		.prepare(
			"INSERT INTO policiais (matricula, nome, cargo, lotacao, senha, ativo) VALUES ('MT1','T','DPC','SEC TOTAL','h',1)"
		)
		.run();
	policial = ultimoId();
});

describe('totalConhecido', () => {
	it('devolve as MESMAS linhas com e sem o total pronto', async () => {
		for (const dia of ['2026-01-10', '2026-02-10', '2026-03-10']) respostaNoDia(dia);

		const semAtalho = await listarTodasRespostasGise(db, { operacaoId: operacao, limit: 2 });
		const comAtalho = await listarTodasRespostasGise(db, {
			operacaoId: operacao,
			limit: 2,
			totalConhecido: semAtalho.total
		});

		expect(comAtalho.respostas.map((r) => r.id)).toEqual(semAtalho.respostas.map((r) => r.id));
		expect(comAtalho.total).toBe(semAtalho.total);
		expect(comAtalho.totalPages).toBe(semAtalho.totalPages);
	});

	it('a página 2 continua trazendo o resto quando o total vem pronto', async () => {
		for (const dia of ['2026-01-10', '2026-02-10', '2026-03-10']) respostaNoDia(dia);

		const p1 = await listarTodasRespostasGise(db, { operacaoId: operacao, limit: 2, page: 1 });
		const p2 = await listarTodasRespostasGise(db, {
			operacaoId: operacao,
			limit: 2,
			page: 2,
			totalConhecido: p1.total
		});

		expect(p1.respostas).toHaveLength(2);
		expect(p2.respostas).toHaveLength(1);
		// O painel concatena as páginas: nenhuma linha pode aparecer nas duas.
		const ids = [...p1.respostas, ...p2.respostas].map((r) => r.id);
		expect(new Set(ids).size).toBe(3);
	});

	it('o total passado VENCE — prova de que a contagem não roda', async () => {
		for (const dia of ['2026-01-10', '2026-02-10', '2026-03-10']) respostaNoDia(dia);

		const r = await listarTodasRespostasGise(db, {
			operacaoId: operacao,
			limit: 2,
			totalConhecido: 99
		});

		expect(r.total).toBe(99);
		expect(r.totalPages).toBe(50);
		// E as linhas seguem sendo as reais: o total mentiroso não inventa dados.
		expect(r.respostas).toHaveLength(2);
	});

	it('`0` é total válido e não cai no default do `count`', async () => {
		respostaNoDia('2026-01-10');

		const r = await listarTodasRespostasGise(db, { operacaoId: operacao, totalConhecido: 0 });

		expect(r.total).toBe(0);
		expect(r.totalPages).toBe(0);
	});
});
