/**
 * `buscarGiseDetalhadoEmLote` — o que muda quando N escalas são montadas de uma
 * vez em vez de uma por chamada.
 *
 * O agrupamento em memória funciona porque quase toda chave envolvida é PK, e
 * PK é única ENTRE escalas: slot, seccional e equipe podem ir para um mapa só.
 * Duas coisas NÃO são, e são exatamente o que estes testes cercam — as duas
 * falhariam mostrando dado de uma escala dentro de outra, sem erro nenhum:
 *
 *  - **presença** é `(gise_id, policial_id)`. O mesmo policial escalado em duas
 *    GISEs tem duas linhas; um mapa chaveado só por policial entregaria a
 *    presença errada para uma delas;
 *  - **assinaturas de relatório extra** viraram `count(*)` com `GROUP BY`, e
 *    contagem agrupada errada é um número plausível — ninguém percebe.
 *
 * O resto é equivalência: o que o lote devolve para um id tem de ser o mesmo
 * que `buscarGiseDetalhado` devolve sozinho, senão o export e a tela passam a
 * divergir.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { bancoMigrado, drizzleSobre } from '../../__tests__/sqlite-migrado';
import { buscarGiseDetalhado, buscarGiseDetalhadoEmLote } from '../escalas-detalhado';
import type { Database } from '../../core';

let sqlite: DatabaseSync;
let db: Database;
let seccional: number;
let policial: number;
/** Duas GISEs, o MESMO policial escalado nas duas. */
let giseA: number;
let giseB: number;

function ultimoId(): number {
	return Number((sqlite.prepare('SELECT last_insert_rowid() AS i').get() as { i: number }).i);
}

/** Uma GISE com uma seccional, um slot, uma equipe e o policial dentro. */
function montarGise(data: string): number {
	sqlite
		.prepare(
			"INSERT INTO gise_escalas (data_inicio, status, hora_entrada, hora_saida) VALUES (?, 'finalizada', '08:00', '16:00')"
		)
		.run(data);
	const giseId = ultimoId();
	sqlite
		.prepare('INSERT INTO gise_seccionais (gise_id, seccional_id) VALUES (?, ?)')
		.run(giseId, seccional);
	const secId = ultimoId();
	sqlite
		.prepare('INSERT INTO gise_seccional_unidades (gise_seccional_id, unidade_id) VALUES (?, ?)')
		.run(secId, seccional);
	const slotId = ultimoId();
	sqlite
		.prepare(
			"INSERT INTO gise_equipes (gise_seccional_id, gise_unidade_id, tipo, slots_dpc, slots_oip) VALUES (?, ?, 'operacional', 1, 3)"
		)
		.run(secId, slotId);
	const equipeId = ultimoId();
	sqlite
		.prepare('INSERT INTO gise_membros (equipe_id, policial_id, gise_id) VALUES (?, ?, ?)')
		.run(equipeId, policial, giseId);
	return giseId;
}

/** A equipe da GISE, alcançada pelo caminho que a tela usa. */
function equipeDe(g: Awaited<ReturnType<typeof buscarGiseDetalhado>> | undefined) {
	return g?.seccionais?.[0]?.unidades?.[0]?.equipes?.[0];
}

beforeEach(() => {
	sqlite = bancoMigrado();
	db = drizzleSobre(sqlite);
	sqlite.prepare("INSERT INTO unidades (nome, tipo) VALUES ('SEC LOTE', 'seccional')").run();
	seccional = ultimoId();
	sqlite
		.prepare(
			"INSERT INTO policiais (matricula, nome, cargo, lotacao, senha, ativo) VALUES ('ML1','Policial do Lote','DPC','SEC LOTE','h',1)"
		)
		.run();
	policial = ultimoId();
	giseA = montarGise('2026-05-01');
	giseB = montarGise('2026-06-01');
});

describe('buscarGiseDetalhadoEmLote', () => {
	it('devolve uma entrada por id pedido', async () => {
		const mapa = await buscarGiseDetalhadoEmLote(db, [giseA, giseB]);

		expect(mapa.size).toBe(2);
		expect(mapa.get(giseA)?.data_inicio).toBe('2026-05-01');
		expect(mapa.get(giseB)?.data_inicio).toBe('2026-06-01');
	});

	it('id inexistente simplesmente não aparece no mapa', async () => {
		const mapa = await buscarGiseDetalhadoEmLote(db, [giseA, 4242]);

		expect(mapa.has(giseA)).toBe(true);
		expect(mapa.has(4242)).toBe(false);
	});

	it('lista vazia não consulta nada e devolve mapa vazio', async () => {
		expect((await buscarGiseDetalhadoEmLote(db, [])).size).toBe(0);
	});

	it('id repetido não duplica nem quebra', async () => {
		const mapa = await buscarGiseDetalhadoEmLote(db, [giseA, giseA]);

		expect(mapa.size).toBe(1);
		expect(mapa.get(giseA)?.id).toBe(giseA);
	});

	/**
	 * O ponto principal. O mesmo policial está nas duas GISEs; só na A ele bateu
	 * entrada e saída. Chavear a presença só por `policial_id` faria a B herdar a
	 * presença da A — inclusive `temSaidaConfirmada`, que decide se a escala pode
	 * ser assinada.
	 */
	it('presença NÃO vaza entre escalas do mesmo policial', async () => {
		sqlite
			.prepare(
				"INSERT INTO gise_presencas (gise_id, policial_id, entrada_timestamp, saida_timestamp) VALUES (?, ?, '2026-05-01 08:00:00', '2026-05-01 16:00:00')"
			)
			.run(giseA, policial);

		const mapa = await buscarGiseDetalhadoEmLote(db, [giseA, giseB]);

		expect(equipeDe(mapa.get(giseA))?.membros?.[0]?.presenca?.saida_timestamp).toBe(
			'2026-05-01 16:00:00'
		);
		expect(equipeDe(mapa.get(giseB))?.membros?.[0]?.presenca).toBeNull();
		expect(mapa.get(giseA)?.temSaidaConfirmada).toBe(true);
		expect(mapa.get(giseB)?.temSaidaConfirmada).toBe(false);
	});

	/** A contagem agrupada errada devolve um número plausível — daí o teste. */
	it('conta assinaturas de relatório extra por escala, não do lote inteiro', async () => {
		sqlite
			.prepare(
				"INSERT INTO gise_assinaturas_relatorios (gise_id, seccional_id, tipo, assinante_nome, tipo_assinatura) VALUES (?, ?, 'extraordinario', 'Assinante', 'simples')"
			)
			.run(giseA, seccional);

		const mapa = await buscarGiseDetalhadoEmLote(db, [giseA, giseB]);

		expect(mapa.get(giseA)?.assinaturasRelatorioExtra).toBe(1);
		expect(mapa.get(giseB)?.assinaturasRelatorioExtra).toBe(0);
	});

	it('cada escala recebe só as SUAS seccionais e equipes', async () => {
		const mapa = await buscarGiseDetalhadoEmLote(db, [giseA, giseB]);

		for (const id of [giseA, giseB]) {
			const g = mapa.get(id);
			expect(g?.seccionais).toHaveLength(1);
			expect(g?.seccionais?.[0]?.unidades).toHaveLength(1);
			expect(equipeDe(g)?.membros).toHaveLength(1);
			expect(g?.totalSeccionais).toBe(1);
		}
		// Equipes distintas: um mapa global mal chaveado devolveria a mesma.
		expect(equipeDe(mapa.get(giseA))?.id).not.toBe(equipeDe(mapa.get(giseB))?.id);
	});

	/**
	 * `buscarGiseDetalhado` virou um caso particular deste lote. Se os dois
	 * divergirem, a tela e o export passam a contar histórias diferentes sobre a
	 * mesma escala.
	 */
	it('concorda com `buscarGiseDetalhado` para o mesmo id', async () => {
		sqlite
			.prepare(
				"INSERT INTO gise_presencas (gise_id, policial_id, entrada_timestamp) VALUES (?, ?, '2026-05-01 08:00:00')"
			)
			.run(giseA, policial);

		const sozinho = await buscarGiseDetalhado(db, giseA);
		const doLote = (await buscarGiseDetalhadoEmLote(db, [giseA, giseB])).get(giseA);

		expect(doLote).toEqual(sozinho);
	});
});
