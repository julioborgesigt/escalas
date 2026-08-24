/**
 * A tranca da decisão de cadastro é o `WHERE status='pendente'` (SEC-36).
 * Sem ele, o segundo clique reaplicava o patch no policial — inclusive
 * depois de o valor_novo ter sido mexido na linha já decidida.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { bancoMigrado, drizzleSobre } from '$lib/db/__tests__/sqlite-migrado';
import { decidirSolicitacaoCadastro } from '../solicitacoes';
import type { Database } from '$lib/db';

const POL = 44101;

let db: Database;
let sqlite: ReturnType<typeof bancoMigrado>;

beforeEach(() => {
	sqlite = bancoMigrado();
	db = drizzleSobre(sqlite);
	sqlite.exec(`
		INSERT INTO policiais (id, matricula, nome, cargo, lotacao, senha)
		VALUES (${POL}, 'M44101', 'Solicitante', 'OIP', 'DEL A', 'h');
		INSERT INTO cadastro_solicitacoes (id, policial_id, campo, valor_atual, valor_novo, status)
		VALUES (1, ${POL}, 'lotacao', 'DEL A', 'DEL B', 'pendente');
	`);
});

describe('decidirSolicitacaoCadastro (SEC-36)', () => {
	it('aprova uma vez e aplica o valor no cadastro', async () => {
		const r = await decidirSolicitacaoCadastro(db, 1, true, 99);
		expect(r?.status).toBe('aprovada');
		const row = sqlite.prepare('SELECT lotacao FROM policiais WHERE id = ?').get(POL) as {
			lotacao: string;
		};
		expect(row.lotacao).toBe('DEL B');
	});

	it('segunda decisão não reaplica o patch', async () => {
		await decidirSolicitacaoCadastro(db, 1, true, 99);
		sqlite.exec(`UPDATE cadastro_solicitacoes SET valor_novo = 'DEL C' WHERE id = 1`);
		const segunda = await decidirSolicitacaoCadastro(db, 1, true, 99);
		expect(segunda).toBeNull();
		const row = sqlite.prepare('SELECT lotacao FROM policiais WHERE id = ?').get(POL) as {
			lotacao: string;
		};
		expect(row.lotacao).toBe('DEL B');
	});

	it('rejeitar e depois aprovar não muda o cadastro', async () => {
		const rejeitada = await decidirSolicitacaoCadastro(db, 1, false, 99);
		expect(rejeitada?.status).toBe('rejeitada');
		expect(await decidirSolicitacaoCadastro(db, 1, true, 99)).toBeNull();
		const row = sqlite.prepare('SELECT lotacao FROM policiais WHERE id = ?').get(POL) as {
			lotacao: string;
		};
		expect(row.lotacao).toBe('DEL A');
	});
});
