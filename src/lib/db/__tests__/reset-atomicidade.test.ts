/**
 * O reset destrutivo é tudo-ou-nada — FLW-WEBHOOK-001.
 *
 * Eram catorze `await db.delete(...)` em sequência. Uma falha na oitava deixava
 * sete tabelas vazias e sete cheias — um estado que nenhuma tela do sistema sabe
 * representar, num banco que acabou de perder metade do cadastro. E a auditoria
 * só era tentada DEPOIS das catorze, então essa falha não deixava registro
 * nenhum de que alguém tinha mandado apagar.
 *
 * O teste roda contra o `batch` do harness, que executa dentro de uma transação
 * real do SQLite — é o que o D1 faz. Sem essa propriedade no harness, o caso
 * abaixo passaria com o código NÃO atômico: uma sequência disfarçada de
 * transação apaga na mesma ordem e ninguém percebe a diferença até produção.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import type { Database } from '$lib/db';
import { bancoMigrado, drizzleSobre } from './sqlite-migrado';
import { escalas, policiais, unidades } from '../../server/schema';

let db: Database;
let sqlite: ReturnType<typeof bancoMigrado>;

beforeEach(() => {
	sqlite = bancoMigrado();
	db = drizzleSobre(sqlite);
	// Ids altos: as migrations já semeiam unidades, e colidir aqui daria um erro
	// de UNIQUE que nada tem a ver com o que o teste mede.
	sqlite.exec(`
		INSERT INTO unidades (id, nome, tipo) VALUES (90001, 'DELEGACIA ATOMICA', 'delegacia');
		INSERT INTO policiais (id, matricula, nome, cargo, lotacao, senha, ativo)
		VALUES (90001, 'M90001', 'Fulano', 'DPC', 'DELEGACIA ATOMICA', 'h', 1);
		INSERT INTO escalas (id, titulo, cidade, tipo, lotacao, data_inicio, data_fim)
		VALUES (90001, 'Escala', 'Fortaleza', 'plantao', 'DELEGACIA ATOMICA', '2026-01-01', '2026-01-31');
	`);
	antes = {
		escalas: contar('escalas'),
		policiais: contar('policiais'),
		unidades: contar('unidades')
	};
});

let antes: { escalas: number; policiais: number; unidades: number };

const contar = (tabela: string) =>
	(sqlite.prepare(`SELECT COUNT(*) AS n FROM ${tabela}`).get() as { n: number }).n;

describe('batch de deleção', () => {
	it('apaga tudo quando todas as instruções passam', async () => {
		await db.batch([db.delete(escalas), db.delete(policiais), db.delete(unidades)]);

		expect(contar('escalas')).toBe(0);
		expect(contar('policiais')).toBe(0);
		expect(contar('unidades')).toBe(0);
	});

	it('falha no MEIO não apaga nada — nem o que veio antes dela', async () => {
		// É a propriedade inteira do achado. Com deleções em sequência, `escalas`
		// já teria sumido quando a segunda instrução falhasse, e o banco ficaria
		// num estado impossível: escala apagada, policial e unidade de pé.
		await expect(
			db.batch([
				db.delete(escalas),
				// Tabela inexistente: falha no meio da transação, como falharia uma
				// FK, um lock ou uma indisponibilidade momentânea.
				db.run(sql`DELETE FROM tabela_que_nao_existe`),
				db.delete(policiais),
				db.delete(unidades)
			])
		).rejects.toThrow();

		expect(contar('escalas'), 'a deleção anterior à falha tem de ser revertida').toBe(
			antes.escalas
		);
		expect(contar('policiais')).toBe(antes.policiais);
		expect(contar('unidades')).toBe(antes.unidades);
	});

	it('o banco continua utilizável depois do rollback', async () => {
		// Rollback mal feito deixa a conexão dentro de uma transação aberta, e a
		// próxima escrita falha por motivo que não tem nada a ver com a original.
		await db.batch([db.delete(escalas), db.run(sql`DELETE FROM nao_existe`)]).catch(() => {});

		await db.batch([db.delete(escalas)]);
		expect(contar('escalas')).toBe(0);
		expect(contar('policiais'), 'a segunda transação não pode ter levado o resto').toBe(
			antes.policiais
		);
	});
});
