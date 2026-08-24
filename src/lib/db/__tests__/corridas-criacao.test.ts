/**
 * As duas trancas que a auditoria de 21/ago instalou — SEC-34 e SEC-35 — contra
 * SQLite de verdade, com as migrações reais aplicadas.
 *
 * Mock do query builder não serve aqui: o comportamento sob teste É o SQL. O
 * `uq_escalas_mensal` é índice de EXPRESSÃO (`substr`) e PARCIAL (`WHERE tipo
 * IN (...)`) — as duas coisas que um fake do drizzle não tem como reproduzir, e
 * que são exatamente onde um erro de sintaxe passaria despercebido até a
 * migração rodar em produção.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import type { Database } from '$lib/db';
import { bancoMigrado, drizzleSobre } from './sqlite-migrado';
import { criarEscala } from '../escalas';
import { finalizarGiseEscala } from '../gise/escalas-crud';
import { ehViolacaoUnique } from '../../server/db-errors';

let db: Database;
let sqlite: ReturnType<typeof bancoMigrado>;

const LOTACAO = 'DELEGACIA DE CORRIDA';

beforeEach(() => {
	sqlite = bancoMigrado();
	db = drizzleSobre(sqlite);
	sqlite.exec(`
		INSERT INTO unidades (id, nome, tipo) VALUES (91001, '${LOTACAO}', 'delegacia');
	`);
});

function escala(over: Partial<Record<string, string>> = {}) {
	return {
		titulo: 'ESCALA',
		cidade: 'Fortaleza',
		horario: '',
		hora_entrada: '08:00',
		hora_saida: '18:00',
		lotacao: LOTACAO,
		tipo: 'plantao' as const,
		data_inicio: '2026-03-01',
		data_fim: '2026-03-31',
		...over
	};
}

describe('uq_escalas_mensal (SEC-34)', () => {
	it('a segunda escala mensal do mesmo mês é recusada pelo banco', async () => {
		await criarEscala(db, escala());
		await expect(criarEscala(db, escala())).rejects.toSatisfy(ehViolacaoUnique);
	});

	it('recusa mesmo com data_inicio DIFERENTE dentro do mesmo mês', async () => {
		// É o ponto do índice de expressão: a regra colide por MÊS. Um unique em
		// (lotacao, tipo, data_inicio) deixaria este caso passar — e é o caso que
		// `verificarEscalaExistente` recusa.
		await criarEscala(db, escala({ data_inicio: '2026-03-01' }));
		await expect(criarEscala(db, escala({ data_inicio: '2026-03-15' }))).rejects.toSatisfy(
			ehViolacaoUnique
		);
	});

	it('meses diferentes convivem', async () => {
		await criarEscala(db, escala({ data_inicio: '2026-03-01', data_fim: '2026-03-31' }));
		await expect(
			criarEscala(db, escala({ data_inicio: '2026-04-01', data_fim: '2026-04-30' }))
		).resolves.toBeDefined();
	});

	it('tipos diferentes no mesmo mês convivem', async () => {
		await criarEscala(db, escala({ tipo: 'plantao' }));
		await expect(criarEscala(db, escala({ tipo: 'expediente' }))).resolves.toBeDefined();
	});

	it('lotações diferentes no mesmo mês convivem', async () => {
		sqlite.exec(`INSERT INTO unidades (id, nome, tipo) VALUES (91002, 'OUTRA DP', 'delegacia');`);
		await criarEscala(db, escala());
		await expect(criarEscala(db, escala({ lotacao: 'OUTRA DP' }))).resolves.toBeDefined();
	});

	it('FDS fica FORA do índice parcial — sobreposição não é expressável em unique', async () => {
		// Registro do resíduo assumido: para FDS a consulta prévia segue sendo a
		// única proteção. Se alguém tornar o índice total, este teste reprova e
		// obriga a pensar na regra de intervalo antes.
		const fds = escala({ tipo: 'fds', data_inicio: '2026-03-07', data_fim: '2026-03-08' });
		await criarEscala(db, fds);
		await expect(criarEscala(db, fds)).resolves.toBeDefined();
	});
});

describe('finalizarGiseEscala — CAS (SEC-35)', () => {
	beforeEach(() => {
		sqlite.exec(`
			INSERT INTO gise_escalas (id, data_inicio, hora_entrada, hora_saida, status)
			VALUES (91001, '2026-03-10', '08:00', '18:00', 'pronta_para_finalizar');
		`);
	});

	function statusAtual(id: number): string {
		const r = sqlite.prepare('SELECT status FROM gise_escalas WHERE id = ?').get(id) as {
			status: string;
		};
		return r.status;
	}

	it('a primeira finalização grava e devolve finalizada:true', async () => {
		await expect(finalizarGiseEscala(db, 91001)).resolves.toEqual({ finalizada: true });
		expect(statusAtual(91001)).toBe('finalizada');
	});

	it('a SEGUNDA não grava e devolve finalizada:false — é o 409 do chamador', async () => {
		await finalizarGiseEscala(db, 91001);
		await expect(finalizarGiseEscala(db, 91001)).resolves.toEqual({ finalizada: false });
	});

	it('finaliza a partir de em_andamento (saída antecipada)', async () => {
		sqlite.exec(`UPDATE gise_escalas SET status = 'em_andamento' WHERE id = 91001;`);
		await expect(finalizarGiseEscala(db, 91001)).resolves.toEqual({ finalizada: true });
	});

	it('status não finalizável não passa pelo WHERE', async () => {
		sqlite.exec(`UPDATE gise_escalas SET status = 'em_preenchimento' WHERE id = 91001;`);
		await expect(finalizarGiseEscala(db, 91001)).resolves.toEqual({ finalizada: false });
		expect(statusAtual(91001)).toBe('em_preenchimento');
	});

	it('escala inexistente não finaliza nada', async () => {
		await expect(finalizarGiseEscala(db, 99999)).resolves.toEqual({ finalizada: false });
	});
});
