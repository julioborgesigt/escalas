/**
 * O filtro de mês/ano de `listarEscalas`, agora expresso como INTERVALO sobre
 * `data_inicio` em vez de `strftime` sobre a coluna.
 *
 * A troca foi por índice: `strftime('%Y', data_inicio) = '2026'` é função sobre
 * a coluna, e o SQLite então usa `idx_escalas_lotacao_tipo_data` só até `tipo` —
 * varrendo o grupo `(lotação, tipo)` inteiro para filtrar a data. Com o
 * intervalo, a terceira coluna do índice entra no seek.
 *
 * Só que trocar predicado é trocar SEMÂNTICA se a borda escorregar, e o modo de
 * errar é silencioso: uma escala do dia 1º ou do dia 31 somem da listagem sem
 * nada acusar. Por isso o que estes testes cercam são as bordas, não o plano de
 * execução:
 *
 *  - o primeiro e o último dia do mês pedido ENTRAM;
 *  - o dia anterior e o seguinte FICAM DE FORA;
 *  - dezembro vira janeiro do ano seguinte (o teto é exclusivo, e é o único
 *    ponto onde somar 1 ao mês estouraria);
 *  - fevereiro funciona sem ninguém saber quantos dias ele tem, que é a razão
 *    de o teto ser exclusivo em vez de "último dia do mês";
 *  - ano sozinho continua pegando o ano inteiro.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { bancoMigrado, drizzleSobre } from './sqlite-migrado';
import { listarEscalas } from '../escalas';
import type { Database } from '../core';

let sqlite: DatabaseSync;
let db: Database;

const LOTACAO = 'DP JANELA';

/**
 * Tipo `fds` de propósito: `uq_escalas_mensal` admite UMA escala por
 * lotação/mês para plantão e expediente, e estes testes precisam de várias no
 * mesmo mês para exercitar as bordas do dia. O índice é parcial e não alcança
 * FDS — que é justamente o tipo com várias por mês na vida real.
 */
function criarEscala(dataInicio: string) {
	sqlite
		.prepare(
			"INSERT INTO escalas (titulo, cidade, lotacao, tipo, data_inicio, data_fim) VALUES (?, 'Cidade', ?, 'fds', ?, ?)"
		)
		.run(`Escala ${dataInicio}`, LOTACAO, dataInicio, dataInicio);
}

/** As datas devolvidas pelo filtro, ordenadas para comparação estável. */
async function datasDe(mes?: number, ano?: number): Promise<string[]> {
	const r = await listarEscalas(db, LOTACAO, undefined, mes, ano, undefined, undefined, undefined, {
		limit: 100
	});
	return r.escalas.map((e) => e.data_inicio).sort();
}

beforeEach(() => {
	sqlite = bancoMigrado();
	db = drizzleSobre(sqlite);
});

describe('filtro de mês/ano por intervalo', () => {
	it('inclui o primeiro e o último dia do mês, e exclui os vizinhos', async () => {
		for (const d of ['2026-05-31', '2026-06-01', '2026-06-15', '2026-06-30', '2026-07-01']) {
			criarEscala(d);
		}

		expect(await datasDe(6, 2026)).toEqual(['2026-06-01', '2026-06-15', '2026-06-30']);
	});

	it('dezembro fecha no ano seguinte', async () => {
		for (const d of ['2026-11-30', '2026-12-01', '2026-12-31', '2027-01-01']) criarEscala(d);

		expect(await datasDe(12, 2026)).toEqual(['2026-12-01', '2026-12-31']);
	});

	it('fevereiro de ano bissexto pega o dia 29', async () => {
		for (const d of ['2028-02-01', '2028-02-29', '2028-03-01']) criarEscala(d);

		expect(await datasDe(2, 2028)).toEqual(['2028-02-01', '2028-02-29']);
	});

	it('fevereiro de ano comum não inventa o dia 29', async () => {
		for (const d of ['2026-02-28', '2026-03-01']) criarEscala(d);

		expect(await datasDe(2, 2026)).toEqual(['2026-02-28']);
	});

	it('ano sozinho pega o ano inteiro e só ele', async () => {
		for (const d of ['2025-12-31', '2026-01-01', '2026-07-15', '2026-12-31', '2027-01-01']) {
			criarEscala(d);
		}

		expect(await datasDe(undefined, 2026)).toEqual(['2026-01-01', '2026-07-15', '2026-12-31']);
	});

	it('sem mês nem ano devolve tudo', async () => {
		for (const d of ['2025-01-01', '2026-06-01', '2027-12-31']) criarEscala(d);

		expect(await datasDe()).toHaveLength(3);
	});

	/**
	 * Mês SEM ano não é um intervalo — "todo junho de qualquer ano" — e continua
	 * em `strftime`. O teste existe para que o ramo não se perca numa próxima
	 * refatoração do filtro.
	 */
	it('mês sem ano ainda recorta o mês, em qualquer ano', async () => {
		for (const d of ['2025-06-10', '2026-06-20', '2026-07-20']) criarEscala(d);

		expect(await datasDe(6, undefined)).toEqual(['2025-06-10', '2026-06-20']);
	});
});
