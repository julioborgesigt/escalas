/**
 * O reenvio do 2FA de login tem de achar o MESMO e-mail que o `tentarLogin`
 * usou. Admin Geral vinculado: linha do policial. Standalone: linha admin.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { Database } from '$lib/db';
import { bancoMigrado, drizzleSobre } from '$lib/db/__tests__/sqlite-migrado';
import { emailInstitucionalDoDesafio } from '../email-2fa';

let db: Database;
let sqlite: ReturnType<typeof bancoMigrado>;

beforeEach(() => {
	sqlite = bancoMigrado();
	db = drizzleSobre(sqlite);
	sqlite.exec(`
		INSERT INTO policiais (id, matricula, nome, cargo, lotacao, senha, ativo, email)
		VALUES (80001, 'M80001', 'Vinculado', 'DPC', 'DEL A', 'x', 1, 'policial@exemplo.gov.br');

		INSERT INTO administradores (id, login, senha, nome, policial_id, email)
		VALUES (80001, 'M80001', 'placeholder', 'Vinculado', 80001, 'admin-linha@exemplo.gov.br'),
		       (80002, 'bootstrap', 'hash-admin', 'Admin Env', NULL, 'root@exemplo.gov.br');
	`);
});

describe('emailInstitucionalDoDesafio (SEC-04)', () => {
	it('policial: o e-mail da própria linha', async () => {
		await expect(emailInstitucionalDoDesafio(db, 'policial', 80001)).resolves.toEqual({
			email: 'policial@exemplo.gov.br',
			nome: 'Vinculado'
		});
	});

	it('admin vinculado: o e-mail do POLICIAL, não o da linha administradores', async () => {
		await expect(emailInstitucionalDoDesafio(db, 'admin', 80001)).resolves.toEqual({
			email: 'policial@exemplo.gov.br',
			nome: 'Vinculado'
		});
	});

	it('admin standalone: o e-mail da linha administradores', async () => {
		await expect(emailInstitucionalDoDesafio(db, 'admin', 80002)).resolves.toEqual({
			email: 'root@exemplo.gov.br',
			nome: 'Admin Env'
		});
	});

	it('admin vinculado com policial inativo não reenvia (mesmo que a linha admin tenha e-mail)', async () => {
		sqlite.exec(`UPDATE policiais SET ativo = 0 WHERE id = 80001`);
		await expect(emailInstitucionalDoDesafio(db, 'admin', 80001)).resolves.toBeNull();
	});
});
