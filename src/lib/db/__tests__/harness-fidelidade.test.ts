/**
 * O harness de banco mente? — as quatro formas em que ele já mentiu.
 *
 * `drizzleSobre` é a peça mais perigosa da suíte: quando ela erra, o teste
 * acusa um bug que não existe (ou, pior, aprova um que existe) e a investigação
 * vai parar no código de produção, que está certo. As falhas abaixo
 * aconteceram de verdade neste projeto, nesta ordem, e cada uma custou uma
 * rodada inteira de depuração no arquivo errado.
 *
 * A quarta é a mais cara e diz por que este arquivo existe: o harness
 * INVENTAVA um campo (`rowsAffected`) que o D1 não tem. Não havia teste
 * possível que a pegasse — todos mediam a invenção. Quem denunciou foi o e2e,
 * que roda sobre D1 de verdade, e só depois de a suíte inteira estar verde.
 *
 * Elas ficam aqui — e não no teste que as descobriu — porque não pertencem a
 * nenhum domínio: são o contrato do driver falso com o drizzle.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { linhasAfetadas, type Database } from '../core';
import { bancoMigrado, drizzleSobre } from './sqlite-migrado';
import { administradores, policiais } from '../../server/schema';
import { eq } from 'drizzle-orm';

let db: Database;
let sqlite: ReturnType<typeof bancoMigrado>;

beforeEach(() => {
	sqlite = bancoMigrado();
	db = drizzleSobre(sqlite);
});

describe('`get` sem resultado devolve undefined, não `[]`', () => {
	it('o chamador enxerga undefined', async () => {
		// `mapGetResult` do drizzle decide "não achou" por FALSY. Um `[]` é
		// truthy: ele mapeia a linha vazia e entrega `{ id: undefined, ... }`,
		// um OBJETO. Todo `if (!row) return notFound()` do código de produção
		// tomava o caminho errado, só nos testes, e em silêncio.
		const achado = await db.select().from(policiais).where(eq(policiais.id, 999999)).get();
		expect(achado).toBeUndefined();
	});

	it('com resultado, devolve a linha', async () => {
		sqlite.exec(`
			INSERT INTO policiais (id, matricula, nome, cargo, lotacao, senha)
			VALUES (81001, 'M81001', 'Alguém', 'DPC', 'DEL A', 'h');
		`);
		const achado = await db.select().from(policiais).where(eq(policiais.id, 81001)).get();
		expect(achado?.matricula).toBe('M81001');
	});
});

describe('`batch` é transação, não sequência', () => {
	it('erro no meio desfaz o que já rodou', async () => {
		// Sem BEGIN/ROLLBACK, um teste de atomicidade mede uma sequência
		// disfarçada de transação — e passa com o código NÃO atômico.
		sqlite.exec(`
			INSERT INTO policiais (id, matricula, nome, cargo, lotacao, senha)
			VALUES (81002, 'M81002', 'Antes', 'DPC', 'DEL A', 'h');
		`);

		await expect(
			db.batch([
				db.update(policiais).set({ nome: 'Depois' }).where(eq(policiais.id, 81002)),
				// Coluna inexistente: estoura no driver, com a primeira já aplicada.
				db.run(sql`UPDATE policiais SET coluna_que_nao_existe = 1`)
			])
		).rejects.toThrow();

		const depois = await db.select().from(policiais).where(eq(policiais.id, 81002)).get();
		expect(depois?.nome, 'o UPDATE anterior ao erro tinha de ter voltado').toBe('Antes');
	});
});

describe('join com nome de coluna repetido não colapsa', () => {
	it('as duas colunas homônimas chegam com o valor de sua tabela', async () => {
		// `stmt.all()` devolve OBJETOS chaveados por nome. `administradores` e
		// `policiais` têm ambos `primeiro_acesso`: as duas viravam UMA chave, e
		// `Object.values` entregava menos colunas do que o SELECT pediu. O
		// drizzle mapeava deslocado e o teste de FLW-AUTH-003 acusava um bug
		// inexistente no código de produção.
		sqlite.exec(`
			INSERT INTO policiais (id, matricula, nome, cargo, lotacao, senha, primeiro_acesso)
			VALUES (81003, 'M81003', 'Vinculado', 'DPC', 'DEL A', 'h', 1);

			INSERT INTO administradores (id, login, senha, nome, policial_id, primeiro_acesso)
			VALUES (81003, 'M81003', 'placeholder', 'Vinculado', 81003, 0);
		`);

		const [linha] = await db
			.select({
				admin: administradores,
				policial_primeiro_acesso: policiais.primeiro_acesso
			})
			.from(administradores)
			.leftJoin(policiais, eq(administradores.policial_id, policiais.id))
			.where(eq(administradores.id, 81003))
			.limit(1);

		expect(linha.admin.primeiro_acesso, 'o valor da linha admin').toBe(0);
		expect(linha.policial_primeiro_acesso, 'o valor da linha do policial').toBe(1);
		expect(linha.admin.login, 'nenhuma coluna deslocou').toBe('M81003');
	});
});

describe('a contagem de linhas vem em `meta.changes`, como no D1', () => {
	beforeEach(() => {
		sqlite.exec(`
			INSERT INTO policiais (id, matricula, nome, cargo, lotacao, senha) VALUES
				(81004, 'M81004', 'Um', 'DPC', 'DEL A', 'h'),
				(81005, 'M81005', 'Dois', 'DPC', 'DEL A', 'h');
		`);
	});

	it('UPDATE que casa devolve a contagem em meta.changes', async () => {
		const r = await db.update(policiais).set({ nome: 'Trocado' }).where(eq(policiais.id, 81004));
		expect(r.meta?.changes).toBe(1);
		expect(linhasAfetadas(r)).toBe(1);
	});

	it('UPDATE que não casa devolve zero — é assim que o código distingue', async () => {
		const r = await db.update(policiais).set({ nome: 'X' }).where(eq(policiais.id, 999999));
		expect(linhasAfetadas(r)).toBe(0);
	});

	it('dentro do batch a contagem também chega', async () => {
		// `unidades.ts` decide a renomeação concorrente pela contagem do PRIMEIRO
		// statement do batch — se ela sumisse aqui, o conflito seria permanente.
		const [primeiro] = await db.batch([
			db.update(policiais).set({ lotacao: 'DEL B' }).where(eq(policiais.cargo, 'DPC')),
			db.update(policiais).set({ nome: 'Z' }).where(eq(policiais.id, 81005))
		]);
		expect(linhasAfetadas(primeiro)).toBe(2);
	});

	it('NÃO existe `rowsAffected` — o campo do better-sqlite3 não é o do D1', async () => {
		// Este é o teste que faltava. Enquanto o harness fabricava `rowsAffected`,
		// os quatro chamadores liam o campo errado, passavam nos testes e devolviam
		// `undefined` em produção. O harness só pode falar a língua do banco real.
		const r = await db.update(policiais).set({ nome: 'Y' }).where(eq(policiais.id, 81004));
		expect((r as Record<string, unknown>).rowsAffected).toBeUndefined();
	});
});
