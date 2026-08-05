/**
 * A sessão do Admin Geral VINCULADO reflete a linha do POLICIAL — FLW-RBAC-001
 * e FLW-AUTH-003.
 *
 * A linha `administradores` de um vinculado é feita de placeholders: senha
 * aleatória que ninguém lê, `primeiro_acesso = 0` gravado por
 * `vincularAdminGeral`. Quem manda é a linha do policial.
 *
 * Os dois achados são o mesmo esquecimento em campos diferentes, e os dois
 * escapavam pelo mesmo motivo: o LOGIN lia o valor certo (via `credPol`), mas a
 * SESSÃO carregava o do placeholder — e é a sessão que o `hooks.server.ts`
 * consulta a cada request. Um teste de login não pegaria nenhum dos dois.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { Database } from '$lib/db';
import { bancoMigrado, drizzleSobre } from '$lib/db/__tests__/sqlite-migrado';
import { buscarAdminAtivo } from '../auth';

let db: Database;
let sqlite: ReturnType<typeof bancoMigrado>;

const POL = 70001;
const ADM_VINCULADO = 70001;
const ADM_STANDALONE = 70002;

beforeEach(() => {
	sqlite = bancoMigrado();
	db = drizzleSobre(sqlite);
	sqlite.exec(`
		INSERT INTO policiais (id, matricula, nome, cargo, lotacao, senha, ativo, primeiro_acesso)
		VALUES (${POL}, 'M70001', 'Recém-cadastrado', 'DPC', 'DEL A', 'hash-real', 1, 1);

		INSERT INTO administradores (id, login, senha, nome, policial_id, primeiro_acesso)
		VALUES (${ADM_VINCULADO}, 'M70001', 'placeholder', 'Recém-cadastrado', ${POL}, 0),
		       (${ADM_STANDALONE}, 'bootstrap', 'hash-admin', 'Admin do env', NULL, 0);
	`);
});

describe('FLW-AUTH-003 — primeiro acesso não é contornado pelo modo admin', () => {
	it('a sessão admin herda o primeiro_acesso do POLICIAL', async () => {
		// O placeholder na linha admin é 0; o policial ainda não trocou a senha.
		// Sem herdar, o hook deixava a pessoa navegar por qualquer rota
		// administrativa sem nunca concluir o primeiro acesso.
		const admin = await buscarAdminAtivo(db, ADM_VINCULADO);
		expect(admin?.primeiro_acesso, 'a linha admin diz 0; quem manda é o policial').toBe(1);
	});

	it('concluído o primeiro acesso do policial, a sessão admin acompanha', async () => {
		sqlite.exec(`UPDATE policiais SET primeiro_acesso = 0 WHERE id = ${POL}`);
		const admin = await buscarAdminAtivo(db, ADM_VINCULADO);
		expect(admin?.primeiro_acesso).toBe(0);
	});

	it('admin STANDALONE continua com o próprio valor', async () => {
		// Sem policial vinculado não há de quem herdar; a linha admin é a fonte.
		sqlite.exec(`UPDATE administradores SET primeiro_acesso = 1 WHERE id = ${ADM_STANDALONE}`);
		const admin = await buscarAdminAtivo(db, ADM_STANDALONE);
		expect(admin?.primeiro_acesso).toBe(1);
	});
});

describe('FLW-RBAC-001 — desativar o policial fecha o modo admin', () => {
	it('policial ativo: a conta admin autentica', async () => {
		await expect(buscarAdminAtivo(db, ADM_VINCULADO)).resolves.not.toBeNull();
	});

	it('policial inativo: a conta admin para de autenticar', async () => {
		sqlite.exec(`UPDATE policiais SET ativo = 0 WHERE id = ${POL}`);
		await expect(buscarAdminAtivo(db, ADM_VINCULADO)).resolves.toBeNull();
	});

	it('admin standalone não é afetado por policial nenhum', async () => {
		sqlite.exec(`UPDATE policiais SET ativo = 0 WHERE id = ${POL}`);
		await expect(buscarAdminAtivo(db, ADM_STANDALONE)).resolves.not.toBeNull();
	});

	it('id inexistente devolve null sem lançar', async () => {
		await expect(buscarAdminAtivo(db, 999999)).resolves.toBeNull();
	});
});
