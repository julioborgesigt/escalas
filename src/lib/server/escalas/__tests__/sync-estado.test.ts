/**
 * Carimbos de `/api/sync/estado` para as telas de ESCALAS, contra um SQLite REAL
 * com todas as migrações aplicadas.
 *
 * O contrato de um carimbo é uma propriedade, não um formato: **muda quando o
 * dado que a tela mostra muda, e não muda quando nada muda**. Um fake de `db`
 * testaria só a concatenação da string — passaria de verde com uma query que
 * ignora a coluna errada. Por isso o banco é de verdade: cada caso grava uma
 * alteração e compara o antes com o depois.
 *
 * Os dois lados importam igualmente:
 * - carimbo que NÃO muda quando deveria → a tela fica desatualizada em silêncio,
 *   que é exatamente o bug que este mecanismo existe para resolver;
 * - carimbo que muda à toa → o poll re-roda o `load` pesado a cada tick,
 *   anulando o ganho de ter um endpoint leve.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import type { Database } from '$lib/db';
import { carimboEscala, carimboPainel, resumoRecebidosAdmin } from '../sync-estado';
import { bancoMigrado, drizzleSobre } from '$lib/db/__tests__/sqlite-migrado';

let sqlite: DatabaseSync;
let db: Database;

/** Executa SQL direto — é assim que os testes provocam a mudança. */
function exec(sql: string) {
	sqlite.exec(sql);
}

beforeAll(() => {
	sqlite = bancoMigrado();
	db = drizzleSobre(sqlite);
	exec(`
		INSERT INTO unidades (id, nome, tipo) VALUES (9001, 'DP TESTE', 'delegacia'), (9002, 'SEC TESTE', 'seccional');
		INSERT INTO policiais (id, matricula, nome, cargo, lotacao, senha, ativo)
			VALUES (10, 'M10', 'Policial Dez', 'OIP', 'DP TESTE', 'x', 1),
			       (11, 'M11', 'Policial Onze', 'DPC', 'DP TESTE', 'x', 1);
		INSERT INTO escalas (id, titulo, cidade, tipo, lotacao, data_inicio, data_fim)
			VALUES (500, 'Escala Teste', 'Fortaleza', 'plantao', 'DP TESTE', '2026-05-01', '2026-05-31');
		INSERT INTO escala_policiais (id, escala_id, policial_id, data_plantao, hora_entrada, hora_saida, equipe)
			VALUES (600, 500, 10, '2026-05-01', '08:00', '20:00', '1');
	`);
});

/** Roda o carimbo, aplica a mudança e roda de novo. */
async function aoRedorDe(
	carimbo: () => Promise<string | null>,
	mudanca: string
): Promise<{ antes: string | null; depois: string | null }> {
	const antes = await carimbo();
	exec(mudanca);
	return { antes, depois: await carimbo() };
}

describe('carimboEscala', () => {
	const alvo = () => carimboEscala(db, 500);

	it('devolve null para escala inexistente', async () => {
		expect(await carimboEscala(db, 999)).toBeNull();
	});

	it('é estável quando nada muda', async () => {
		expect(await alvo()).toBe(await alvo());
	});

	it.each([
		['período', `UPDATE escalas SET data_fim = '2026-06-30' WHERE id = 500`],
		[
			'escalado adicionado',
			`INSERT INTO escala_policiais (id, escala_id, policial_id, data_plantao, hora_entrada, hora_saida, equipe) VALUES (601, 500, 11, '2026-05-02', '08:00', '20:00', '2')`
		],
		['horário do escalado', `UPDATE escala_policiais SET hora_saida = '19:00' WHERE id = 600`]
	])('muda quando muda %s', async (_rotulo, mudanca) => {
		const { antes, depois } = await aoRedorDe(alvo, mudanca);
		expect(depois).not.toBe(antes);
	});
});

describe('carimboPainel e resumoRecebidosAdmin', () => {
	it('o painel é estável quando nada muda', async () => {
		expect(await carimboPainel(db)).toBe(await carimboPainel(db));
	});

	it('recebidos conta os NÃO vistos e o carimbo acompanha', async () => {
		exec(
			`INSERT INTO escala_documentos (id, escala_id, r2_key, assinante_nome, verificacao_hash) VALUES (900, 500, 'k', 'A', 'h')`
		);
		const antes = await resumoRecebidosAdmin(db);
		expect(antes.naoVistos).toBe(1);

		exec(`UPDATE escalas SET visto_por_admin = 1 WHERE id = 500`);
		const depois = await resumoRecebidosAdmin(db);
		expect(depois.naoVistos).toBe(0);
		expect(depois.stamp).not.toBe(antes.stamp);
	});
});
