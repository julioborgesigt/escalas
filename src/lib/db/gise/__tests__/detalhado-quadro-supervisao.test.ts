/**
 * O quadro de supervisão de `buscarGiseDetalhado` — supervisor, assessor e os
 * dois SEINT.
 *
 * Eram QUATRO consultas, uma por papel, cada uma com o seu `Promise.resolve(null)`
 * quando o id era nulo. Viraram UMA, por `inArray`, com um mapa por id. Estes
 * testes travam o que a troca precisa preservar e o que ela passou a garantir:
 *
 *  - id inexistente continua devolvendo `null`. Importa porque a checagem saiu
 *    de antes das consultas para depois do lote: se ela se perdesse, a função
 *    devolveria um objeto espalhando `undefined` em vez de `null`, e todo
 *    `if (!gise)` do código adiante tomaria o caminho errado;
 *  - papel vazio continua vazio, e papel preenchido traz nome, matrícula e
 *    telefone — o mapa não pode trocar um pelo outro;
 *  - **a mesma pessoa em dois papéis aparece nos dois.** Quatro consultas
 *    separadas acertavam isso por acidente (cada uma buscava o seu id); com um
 *    mapa, é preciso que o `get` seja por id e não um `shift` da lista. É o
 *    caso real do supervisor que também é SEINT numa escala pequena.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { bancoMigrado, drizzleSobre } from '../../__tests__/sqlite-migrado';
import { buscarGiseDetalhado } from '../escalas-detalhado';
import type { Database } from '../../core';

let sqlite: DatabaseSync;
let db: Database;

function ultimoId(): number {
	return Number((sqlite.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id);
}

function criarPolicial(matricula: string, nome: string, telefone: string): number {
	sqlite
		.prepare(
			"INSERT INTO policiais (matricula, nome, cargo, lotacao, telefone, senha, ativo) VALUES (?, ?, 'DPC', 'SEC QUADRO', ?, 'h', 1)"
		)
		.run(matricula, nome, telefone);
	return ultimoId();
}

/** Uma GISE com o quadro informado. `null` em qualquer papel é papel vazio. */
function criarGise(quadro: {
	supervisor?: number | null;
	assessor?: number | null;
	seint1?: number | null;
	seint2?: number | null;
}): number {
	sqlite
		.prepare(
			`INSERT INTO gise_escalas (data_inicio, status, hora_entrada, hora_saida, supervisor_id, assessor_id, seint1_id, seint2_id)
			 VALUES ('2026-05-01', 'em_andamento', '08:00', '16:00', ?, ?, ?, ?)`
		)
		.run(
			quadro.supervisor ?? null,
			quadro.assessor ?? null,
			quadro.seint1 ?? null,
			quadro.seint2 ?? null
		);
	return ultimoId();
}

beforeEach(() => {
	sqlite = bancoMigrado();
	db = drizzleSobre(sqlite);
	sqlite.prepare("INSERT INTO unidades (nome, tipo) VALUES ('SEC QUADRO', 'seccional')").run();
});

describe('buscarGiseDetalhado — quadro de supervisão', () => {
	it('devolve null para GISE inexistente', async () => {
		expect(await buscarGiseDetalhado(db, 4242)).toBeNull();
	});

	it('preenche os quatro papéis com nome, matrícula e telefone', async () => {
		const sup = criarPolicial('MS1', 'Supervisora', '85911111111');
		const ass = criarPolicial('MA1', 'Assessor', '85922222222');
		const s1 = criarPolicial('MI1', 'Seint Um', '85933333333');
		const s2 = criarPolicial('MI2', 'Seint Dois', '85944444444');
		const giseId = criarGise({ supervisor: sup, assessor: ass, seint1: s1, seint2: s2 });

		const g = await buscarGiseDetalhado(db, giseId);

		expect(g?.supervisor_nome).toBe('Supervisora');
		expect(g?.supervisor_matricula).toBe('MS1');
		expect(g?.supervisor_telefone).toBe('85911111111');
		expect(g?.assessor_nome).toBe('Assessor');
		expect(g?.seint1_nome).toBe('Seint Um');
		expect(g?.seint2_nome).toBe('Seint Dois');
		// Cada papel com o SEU dado — um mapa trocado passaria nos nomes e
		// falharia aqui.
		expect(g?.seint2_matricula).toBe('MI2');
	});

	it('papel não designado vem null, sem afetar os designados', async () => {
		const sup = criarPolicial('MS2', 'Só a Supervisora', '85955555555');
		const giseId = criarGise({ supervisor: sup });

		const g = await buscarGiseDetalhado(db, giseId);

		expect(g?.supervisor_nome).toBe('Só a Supervisora');
		expect(g?.assessor_nome).toBeNull();
		expect(g?.seint1_nome).toBeNull();
		expect(g?.seint2_nome).toBeNull();
		expect(g?.assessor_matricula).toBeNull();
	});

	it('a MESMA pessoa em dois papéis aparece nos dois', async () => {
		const pessoa = criarPolicial('MX1', 'Acumula Papéis', '85966666666');
		const giseId = criarGise({ supervisor: pessoa, seint1: pessoa });

		const g = await buscarGiseDetalhado(db, giseId);

		expect(g?.supervisor_nome).toBe('Acumula Papéis');
		expect(g?.seint1_nome).toBe('Acumula Papéis');
		expect(g?.supervisor_matricula).toBe('MX1');
		expect(g?.seint1_matricula).toBe('MX1');
	});

	it('GISE sem quadro nenhum não quebra', async () => {
		const giseId = criarGise({});

		const g = await buscarGiseDetalhado(db, giseId);

		expect(g).not.toBeNull();
		expect(g?.supervisor_nome).toBeNull();
		expect(g?.seccionais).toEqual([]);
	});
});
