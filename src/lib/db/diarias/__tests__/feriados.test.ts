/**
 * O seed de `feriados` (migração 0077) e a leitura por intervalo.
 *
 * As datas conferidas aqui são as que decidem dinheiro: feriado conta como fim
 * de semana na contagem de diárias. As da Sexta-feira da Paixão vêm do cálculo
 * da Páscoa no gerador, e um erro ali sairia no ano inteiro sem ninguém notar —
 * por isso os cinco anos vão conferidos um a um contra o calendário publicado.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import type { Database } from '$lib/db';
import { bancoMigrado, drizzleSobre } from '../../__tests__/sqlite-migrado';
import { feriadosNoIntervalo } from '../feriados';

let db: Database;
let sqlite: ReturnType<typeof bancoMigrado>;

beforeAll(() => {
	sqlite = bancoMigrado();
	db = drizzleSobre(sqlite);
});

describe('seed nacional (0077)', () => {
	it('tem 10 feriados por ano, de 2026 a 2030', () => {
		for (let ano = 2026; ano <= 2030; ano++) {
			const n = sqlite
				.prepare(`SELECT count(*) AS n FROM feriados WHERE data LIKE '${ano}-%'`)
				.get() as { n: number };
			expect(n.n, String(ano)).toBe(10);
		}
	});

	it('a Sexta-feira da Paixão cai na data certa em cada ano', () => {
		const linhas = sqlite
			.prepare(`SELECT data FROM feriados WHERE descricao = 'Sexta-feira da Paixão' ORDER BY data`)
			.all() as { data: string }[];
		expect(linhas.map((l) => l.data)).toEqual([
			'2026-04-03',
			'2027-03-26',
			'2028-04-14',
			'2029-03-30',
			'2030-04-19'
		]);
	});

	it('não semeia ponto facultativo nem feriado estadual', () => {
		const n = sqlite
			.prepare(
				`SELECT count(*) AS n FROM feriados WHERE abrangencia <> 'nacional' OR uf <> '' OR descricao LIKE '%Carnaval%' OR descricao LIKE '%Corpus%'`
			)
			.get() as { n: number };
		expect(n.n).toBe(0);
	});

	it('toda linha diz de onde veio', () => {
		const n = sqlite
			.prepare(`SELECT count(*) AS n FROM feriados WHERE fonte = '' OR fonte IS NULL`)
			.get() as { n: number };
		expect(n.n).toBe(0);
	});
});

describe('feriadosNoIntervalo', () => {
	it('devolve os feriados do intervalo, inclusivo nas duas pontas, em ordem', async () => {
		const lista = await feriadosNoIntervalo(db, '2026-11-02', '2026-11-20');
		expect(lista.map((f) => f.data)).toEqual(['2026-11-02', '2026-11-15', '2026-11-20']);
	});

	it('intervalo sem feriado devolve lista vazia', async () => {
		expect(await feriadosNoIntervalo(db, '2026-06-01', '2026-06-30')).toEqual([]);
	});

	it('feriado estadual de outra UF não entra; o da UF pedida entra', async () => {
		sqlite.exec(`
			INSERT INTO feriados (data, abrangencia, uf, descricao, fonte)
			VALUES ('2026-03-25', 'estadual', 'CE', 'Data Magna do Ceará', 'teste'),
			       ('2026-03-25', 'estadual', 'SP', 'Outro', 'teste');
		`);
		const ce = await feriadosNoIntervalo(db, '2026-03-01', '2026-03-31', 'CE');
		expect(ce.map((f) => f.uf)).toEqual(['CE']);
		const sem = await feriadosNoIntervalo(db, '2026-03-01', '2026-03-31', 'PE');
		expect(sem).toEqual([]);
	});
});
