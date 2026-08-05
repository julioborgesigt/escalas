/**
 * Vaga e exclusividade decididas NA GRAVAÇÃO — FLW-GISE-009.
 *
 * A proteção inteira era um conjunto de consultas feitas antes do INSERT. Entre
 * a consulta e a gravação cabe outra requisição: dois admins de seccionais
 * diferentes alocavam o mesmo policial ao mesmo tempo, e os dois viam vaga
 * livre. O resultado é uma pessoa escalada em dois lugares no mesmo dia — que o
 * termo de presença e o relatório de extra depois atestam.
 *
 * Os testes de corrida abaixo não usam paralelismo real (o harness é um SQLite
 * síncrono, e o D1 serializa escritas de qualquer forma). Eles reproduzem o que
 * a corrida PRODUZ: duas gravações a partir do mesmo estado observado. Com a
 * decisão fora da escrita, as duas passavam; com ela dentro, a segunda encontra
 * o mundo já mudado. É a propriedade que importa, e é testável sem threads.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { Database } from '$lib/db';
import { bancoMigrado, drizzleSobre } from '$lib/db/__tests__/sqlite-migrado';
import { adicionarGiseMembro } from '../membros';

let db: Database;
let sqlite: ReturnType<typeof bancoMigrado>;

const GISE = 95001;
const SEC_A = 95101;
const SEC_B = 95102;
const EQUIPE_A = 95201;
const EQUIPE_B = 95202;
const UNID_A = 95301;
const UNID_B = 95302;
const DPC = 95401;
const DPC2 = 95402;
const OIP = 95403;

const membros = () =>
	sqlite
		.prepare('SELECT equipe_id, policial_id, gise_id FROM gise_membros ORDER BY id')
		.all() as { equipe_id: number; policial_id: number; gise_id: number | null }[];

beforeEach(() => {
	sqlite = bancoMigrado();
	db = drizzleSobre(sqlite);
	sqlite.exec(`
		INSERT INTO unidades (id, nome, tipo) VALUES
			(${UNID_A}, 'SECCIONAL A', 'seccional'),
			(${UNID_B}, 'SECCIONAL B', 'seccional');

		INSERT INTO policiais (id, matricula, nome, cargo, lotacao, senha) VALUES
			(${DPC}, 'M95401', 'Delegado', 'DPC', 'DEL A', 'h'),
			(${DPC2}, 'M95402', 'Delegada', 'DPC', 'DEL A', 'h'),
			(${OIP}, 'M95403', 'Investigador', 'OIP', 'DEL A', 'h');

		INSERT INTO gise_escalas (id, data_inicio, status)
		VALUES (${GISE}, '2026-09-01', 'em_preenchimento');

		INSERT INTO gise_seccionais (id, gise_id, seccional_id, status) VALUES
			(${SEC_A}, ${GISE}, ${UNID_A}, 'pendente'),
			(${SEC_B}, ${GISE}, ${UNID_B}, 'pendente');

		-- Uma vaga de DPC e uma de OIP em cada equipe.
		INSERT INTO gise_equipes (id, gise_seccional_id, tipo, slots_dpc, slots_oip) VALUES
			(${EQUIPE_A}, ${SEC_A}, 'operacional', 1, 1),
			(${EQUIPE_B}, ${SEC_B}, 'operacional', 1, 1);
	`);
});

describe('caminho feliz', () => {
	it('aloca e deriva o gise_id da própria equipe', async () => {
		await expect(adicionarGiseMembro(db, EQUIPE_A, DPC)).resolves.toEqual({ ok: true });
		expect(membros()).toEqual([{ equipe_id: EQUIPE_A, policial_id: DPC, gise_id: GISE }]);
	});

	it('cargos diferentes ocupam vagas diferentes na mesma equipe', async () => {
		await expect(adicionarGiseMembro(db, EQUIPE_A, DPC)).resolves.toEqual({ ok: true });
		await expect(adicionarGiseMembro(db, EQUIPE_A, OIP)).resolves.toEqual({ ok: true });
		expect(membros()).toHaveLength(2);
	});

	it('equipe inexistente é recusada sem lançar', async () => {
		await expect(adicionarGiseMembro(db, 999999, DPC)).resolves.toEqual({
			ok: false,
			motivo: 'equipe_inexistente'
		});
	});
});

describe('a vaga não é vendida duas vezes', () => {
	it('a segunda gravação na mesma vaga é recusada', async () => {
		// As duas partem do mesmo estado observado ("uma vaga de DPC, livre").
		await expect(adicionarGiseMembro(db, EQUIPE_A, DPC)).resolves.toEqual({ ok: true });
		await expect(adicionarGiseMembro(db, EQUIPE_A, DPC2)).resolves.toEqual({
			ok: false,
			motivo: 'sem_vaga'
		});
		expect(membros(), 'a equipe tinha UMA vaga de DPC').toHaveLength(1);
	});

	it('o limite é por CARGO, não por equipe', async () => {
		await adicionarGiseMembro(db, EQUIPE_A, DPC);
		await adicionarGiseMembro(db, EQUIPE_A, OIP);
		// Terceiro DPC não entra; a vaga de OIP já foi.
		await expect(adicionarGiseMembro(db, EQUIPE_A, DPC2)).resolves.toEqual({
			ok: false,
			motivo: 'sem_vaga'
		});
	});

	it('equipe com zero vagas do cargo não aceita ninguém daquele cargo', async () => {
		sqlite.exec(`UPDATE gise_equipes SET slots_dpc = 0 WHERE id = ${EQUIPE_B}`);
		await expect(adicionarGiseMembro(db, EQUIPE_B, DPC)).resolves.toEqual({
			ok: false,
			motivo: 'sem_vaga'
		});
	});
});

describe('um policial, uma escala', () => {
	it('o mesmo policial em DUAS seccionais da mesma GISE é recusado', async () => {
		// O caso do achado: dois admins de seccionais diferentes, cada um vendo a
		// própria vaga livre. Sem o índice único, as duas gravações entravam.
		await expect(adicionarGiseMembro(db, EQUIPE_A, DPC)).resolves.toEqual({ ok: true });
		await expect(adicionarGiseMembro(db, EQUIPE_B, DPC)).resolves.toEqual({
			ok: false,
			motivo: 'ja_escalado'
		});
		expect(membros(), 'ninguém serve em dois lugares no mesmo dia').toHaveLength(1);
	});

	it('o mesmo policial em OUTRA GISE continua permitido', async () => {
		// A exclusividade é POR ESCALA. Escalar a mesma pessoa em dias diferentes é
		// o funcionamento normal do sistema.
		sqlite.exec(`
			INSERT INTO gise_escalas (id, data_inicio, status)
			VALUES (95002, '2026-09-02', 'em_preenchimento');
			INSERT INTO gise_seccionais (id, gise_id, seccional_id, status)
			VALUES (95103, 95002, ${UNID_A}, 'pendente');
			INSERT INTO gise_equipes (id, gise_seccional_id, tipo, slots_dpc, slots_oip)
			VALUES (95203, 95103, 'operacional', 1, 1);
		`);
		await expect(adicionarGiseMembro(db, EQUIPE_A, DPC)).resolves.toEqual({ ok: true });
		await expect(adicionarGiseMembro(db, 95203, DPC)).resolves.toEqual({ ok: true });
		expect(membros()).toHaveLength(2);
	});
});
