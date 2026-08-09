/**
 * `temPresencaGisePendente` — predicado que libera a aba "Presença GISE".
 *
 * Só é true quando o policial está escalado em GISE não finalizada E ainda não
 * bateu a saída (entrada pendente ou só entrada). Quem já saiu, ou cuja GISE
 * foi finalizada, não deve ver a aba — o histórico cobre esses casos.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { Database } from '$lib/db';
import { bancoMigrado, drizzleSobre } from '$lib/db/__tests__/sqlite-migrado';
import { temPresencaGisePendente } from '../escalas-papel';

let db: Database;
let sqlite: ReturnType<typeof bancoMigrado>;

const UNID = 94101;
const P_SEM_NADA = 94201;
const P_MEMBRO_SEM_PRESENCA = 94202;
const P_MEMBRO_SO_ENTRADA = 94203;
const P_MEMBRO_COM_SAIDA = 94204;
const P_MEMBRO_FINALIZADA = 94205;
const P_SUPERVISOR_PENDENTE = 94206;

const GISE_ATIVA = 94001;
const GISE_FINALIZADA = 94002;

function semear() {
	sqlite.exec(`
		INSERT INTO unidades (id, nome, tipo) VALUES (${UNID}, 'SECCIONAL P', 'seccional');

		INSERT INTO policiais (id, matricula, nome, cargo, lotacao, senha) VALUES
			(${P_SEM_NADA}, 'M94201', 'Sem Nada', 'OIP', 'SECCIONAL P', 'h'),
			(${P_MEMBRO_SEM_PRESENCA}, 'M94202', 'Sem Presenca', 'OIP', 'SECCIONAL P', 'h'),
			(${P_MEMBRO_SO_ENTRADA}, 'M94203', 'So Entrada', 'OIP', 'SECCIONAL P', 'h'),
			(${P_MEMBRO_COM_SAIDA}, 'M94204', 'Com Saida', 'OIP', 'SECCIONAL P', 'h'),
			(${P_MEMBRO_FINALIZADA}, 'M94205', 'Membro Final', 'OIP', 'SECCIONAL P', 'h'),
			(${P_SUPERVISOR_PENDENTE}, 'M94206', 'Super Pendente', 'DPC', 'SECCIONAL P', 'h');

		INSERT INTO gise_escalas (id, data_inicio, status, supervisor_id) VALUES
			(${GISE_ATIVA}, '2026-08-10', 'em_andamento', ${P_SUPERVISOR_PENDENTE}),
			(${GISE_FINALIZADA}, '2026-07-01', 'finalizada', NULL);

		INSERT INTO gise_seccionais (id, gise_id, seccional_id, status) VALUES
			(94301, ${GISE_ATIVA}, ${UNID}, 'preenchida'),
			(94302, ${GISE_FINALIZADA}, ${UNID}, 'preenchida');

		INSERT INTO gise_equipes (id, gise_seccional_id, tipo) VALUES
			(94401, 94301, 'operacional'),
			(94402, 94302, 'operacional');

		INSERT INTO gise_membros (equipe_id, policial_id) VALUES
			(94401, ${P_MEMBRO_SEM_PRESENCA}),
			(94401, ${P_MEMBRO_SO_ENTRADA}),
			(94401, ${P_MEMBRO_COM_SAIDA}),
			(94402, ${P_MEMBRO_FINALIZADA});

		INSERT INTO gise_presencas (gise_id, policial_id, entrada_timestamp, saida_timestamp) VALUES
			(${GISE_ATIVA}, ${P_MEMBRO_SO_ENTRADA}, '2026-08-10 08:00:00', NULL),
			(${GISE_ATIVA}, ${P_MEMBRO_COM_SAIDA}, '2026-08-10 08:00:00', '2026-08-10 16:00:00');
	`);
}

beforeEach(() => {
	sqlite = bancoMigrado();
	db = drizzleSobre(sqlite);
	semear();
});

describe('temPresencaGisePendente', () => {
	it('policial sem vínculo GISE não tem pendência', async () => {
		expect(await temPresencaGisePendente(db, P_SEM_NADA)).toBe(false);
	});

	it('membro em GISE ativa sem presença tem pendência', async () => {
		expect(await temPresencaGisePendente(db, P_MEMBRO_SEM_PRESENCA)).toBe(true);
	});

	it('membro com entrada e sem saída tem pendência', async () => {
		expect(await temPresencaGisePendente(db, P_MEMBRO_SO_ENTRADA)).toBe(true);
	});

	it('membro que já bateu a saída não tem pendência', async () => {
		expect(await temPresencaGisePendente(db, P_MEMBRO_COM_SAIDA)).toBe(false);
	});

	it('membro só de GISE finalizada não tem pendência', async () => {
		expect(await temPresencaGisePendente(db, P_MEMBRO_FINALIZADA)).toBe(false);
	});

	it('supervisor de GISE ativa sem saída tem pendência', async () => {
		expect(await temPresencaGisePendente(db, P_SUPERVISOR_PENDENTE)).toBe(true);
	});
});
