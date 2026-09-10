/**
 * A matriz de tempos (migração 0079) e a leitura por par.
 *
 * O que se confere aqui é a FORMA da matriz — cobertura, chave, simetria — e
 * uns poucos pares de sanidade em relação à distância gravada na 0072. O valor
 * em si é o que o OSRM mediu; "matriz errada passa em todo teste", como avisa o
 * gerador, e é por isso que ele confere a rota contra a 0072 ao gerar.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import type { Database } from '$lib/db';
import { bancoMigrado, drizzleSobre } from '../../__tests__/sqlite-migrado';
import { minutosEntreMunicipios, procedenciaDosTempos } from '../tempos';

const IGUATU = '2305506';
const JUAZEIRO = '2307304';
const CRATO = '2304202';
const FORTALEZA = '2304400';

let db: Database;
let sqlite: ReturnType<typeof bancoMigrado>;

beforeAll(() => {
	sqlite = bancoMigrado();
	db = drizzleSobre(sqlite);
});

describe('seed da matriz de tempos (0079)', () => {
	it('cobre os mesmos 16.836 pares da matriz de distâncias, com a mesma chave', () => {
		const r = sqlite
			.prepare(
				`SELECT
				   (SELECT count(*) FROM tempos_municipios) AS tempos,
				   (SELECT count(*) FROM distancias_municipios) AS distancias,
				   (SELECT count(*) FROM tempos_municipios t
				     LEFT JOIN distancias_municipios d
				       ON d.origem_ibge = t.origem_ibge AND d.destino_ibge = t.destino_ibge
				    WHERE d.km IS NULL) AS sem_par,
				   (SELECT count(*) FROM tempos_municipios WHERE origem_ibge >= destino_ibge) AS fora_de_ordem`
			)
			.get() as { tempos: number; distancias: number; sem_par: number; fora_de_ordem: number };
		expect(r.tempos).toBe(16836);
		expect(r.tempos).toBe(r.distancias);
		expect(r.sem_par).toBe(0);
		expect(r.fora_de_ordem).toBe(0);
	});

	it('nenhum tempo é zero ou negativo, e a procedência está gravada', async () => {
		const r = sqlite
			.prepare('SELECT count(*) AS n FROM tempos_municipios WHERE minutos <= 0')
			.get() as { n: number };
		expect(r.n).toBe(0);
		const proc = await procedenciaDosTempos(db);
		expect(proc?.fonte).toContain('OSRM');
		expect(proc?.medido_em).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	});

	it('velocidade média fica numa faixa de estrada em todo par (15 a 110 km/h)', () => {
		// O piso é 15 e não 20 por causa de UM par: Jaguaribara ↔ Jaguaribe, 32 km
		// em 98 min — a travessia do Castanhão no OSM. É a rota, não a medição.
		const r = sqlite
			.prepare(
				`SELECT count(*) AS n FROM tempos_municipios t
				   JOIN distancias_municipios d
				     ON d.origem_ibge = t.origem_ibge AND d.destino_ibge = t.destino_ibge
				  WHERE d.km >= 10 AND (d.km * 60.0 / t.minutos < 15 OR d.km * 60.0 / t.minutos > 110)`
			)
			.get() as { n: number };
		expect(r.n).toBe(0);
	});
});

describe('minutosEntreMunicipios', () => {
	it('a ordem dos códigos não importa', async () => {
		const ida = await minutosEntreMunicipios(db, IGUATU, JUAZEIRO);
		const volta = await minutosEntreMunicipios(db, JUAZEIRO, IGUATU);
		expect(ida).toBe(volta);
		// 154 km de estrada: entre 1h30 e 3h.
		expect(ida).toBeGreaterThanOrEqual(90);
		expect(ida).toBeLessThanOrEqual(180);
	});

	it('vizinhos e distantes ficam na proporção da estrada', async () => {
		const perto = await minutosEntreMunicipios(db, CRATO, JUAZEIRO); // 12 km
		const longe = await minutosEntreMunicipios(db, FORTALEZA, JUAZEIRO); // 488 km
		expect(perto).toBeLessThan(40);
		expect(longe).toBeGreaterThan(300);
	});

	it('mesma cidade é zero; par desconhecido é null', async () => {
		expect(await minutosEntreMunicipios(db, IGUATU, IGUATU)).toBe(0);
		expect(await minutosEntreMunicipios(db, IGUATU, '9999999')).toBeNull();
		expect(await minutosEntreMunicipios(db, '', IGUATU)).toBeNull();
	});
});
