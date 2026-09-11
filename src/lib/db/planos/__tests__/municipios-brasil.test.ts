/**
 * O seed de municípios fora do Ceará (migração 0078) sobre o que a 0072 já
 * tinha. Os dois pontos que importam: o Ceará NÃO muda — é ele que a matriz de
 * distâncias referencia por código — e o resto do país entra completo, com
 * coordenada dentro do Brasil, porque o nome vai impresso no Requerimento.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import type { Database } from '$lib/db';
import { bancoMigrado, drizzleSobre } from '../../__tests__/sqlite-migrado';
import { listarMunicipios } from '../distancias';

let db: Database;
let sqlite: ReturnType<typeof bancoMigrado>;

beforeAll(() => {
	sqlite = bancoMigrado();
	db = drizzleSobre(sqlite);
});

describe('seed de municípios do Brasil (0078)', () => {
	it('o país inteiro: 5.571 municípios em 27 UFs', () => {
		const r = sqlite
			.prepare('SELECT count(*) AS n, count(DISTINCT uf) AS ufs FROM municipios')
			.get() as { n: number; ufs: number };
		expect(r).toMatchObject({ n: 5571, ufs: 27 });
	});

	it('o Ceará continua com os 184 da 0072, intocados', () => {
		const ce = sqlite.prepare("SELECT count(*) AS n FROM municipios WHERE uf = 'CE'").get() as {
			n: number;
		};
		expect(ce.n).toBe(184);
		// Fortaleza como está na 0072 — o INSERT OR IGNORE não pode ter reescrito.
		const fortaleza = sqlite
			.prepare("SELECT nome, lat, lon FROM municipios WHERE ibge = '2304400'")
			.get() as { nome: string; lat: number; lon: number };
		expect(fortaleza.nome).toBe('Fortaleza');
		expect(fortaleza.lat).toBeCloseTo(-3.7275, 4);
		expect(fortaleza.lon).toBeCloseTo(-38.5275, 4);
	});

	it('toda coordenada cai dentro do Brasil', () => {
		const fora = sqlite
			.prepare(
				'SELECT count(*) AS n FROM municipios WHERE lat < -34 OR lat > 6 OR lon < -74 OR lon > -28'
			)
			.get() as { n: number };
		expect(fora.n).toBe(0);
	});

	it('código do IBGE é único e a UF bate com o prefixo do código', () => {
		// Os dois primeiros dígitos do código são a UF: 23 = CE, 26 = PE, 35 = SP.
		const r = sqlite
			.prepare(
				`SELECT
				   (SELECT count(*) FROM municipios WHERE substr(ibge, 1, 2) = '26' AND uf <> 'PE') AS pe,
				   (SELECT count(*) FROM municipios WHERE substr(ibge, 1, 2) = '35' AND uf <> 'SP') AS sp,
				   (SELECT count(*) FROM municipios WHERE uf = 'CE' AND substr(ibge, 1, 2) <> '23') AS ce`
			)
			.get() as { pe: number; sp: number; ce: number };
		expect(r).toEqual({ pe: 0, sp: 0, ce: 0 });
	});

	it('listarMunicipios(db, uf) serve qualquer estado, em ordem alfabética de gente', async () => {
		const pe = await listarMunicipios(db, 'PE');
		expect(pe).toHaveLength(185);
		expect(pe.map((m) => m.nome)).toContain('Recife');
		// Acento não manda para o fim da lista: "Água Preta" vem entre "Agrestina"
		// e "Águas Belas", não depois de "Xexéu" como o ORDER BY do SQLite faria.
		const nomes = pe.map((m) => m.nome);
		expect(nomes.slice(0, 6)).toEqual([
			'Abreu e Lima',
			'Afogados da Ingazeira',
			'Afrânio',
			'Agrestina',
			'Água Preta',
			'Águas Belas'
		]);
		expect(nomes[nomes.length - 1]).toBe('Xexéu');
	});
});
