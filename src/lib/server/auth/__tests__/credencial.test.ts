/**
 * Onde mora a senha, e quais sessões ela destrava — FLW-AUTH-002.
 *
 * Banco de verdade porque a resposta depende do VÍNCULO entre as duas linhas
 * (`administradores.policial_id`), e é justamente esse join que os fluxos
 * erravam ao responder pela metade.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { Database } from '$lib/db';
import { bancoMigrado, drizzleSobre } from '$lib/db/__tests__/sqlite-migrado';
import { resolverCredencial, credencialDoUsuario, revogarSessoesDaCredencial } from '../credencial';

let db: Database;
let sqlite: ReturnType<typeof bancoMigrado>;

const POLICIAL = 10;
const ADMIN_VINCULADO = 20;
const ADMIN_STANDALONE = 21;
const POLICIAL_SOLTO = 11;

beforeEach(() => {
	sqlite = bancoMigrado();
	db = drizzleSobre(sqlite);

	sqlite.exec(`
		INSERT INTO policiais (id, matricula, nome, cargo, lotacao, senha, ativo)
		VALUES (${POLICIAL}, 'M10', 'Com admin vinculado', 'DPC', 'DEL A', 'hash-policial', 1),
		       (${POLICIAL_SOLTO}, 'M11', 'Sem admin', 'OIP', 'DEL A', 'hash-solto', 1);

		INSERT INTO administradores (id, login, senha, nome, policial_id)
		VALUES (${ADMIN_VINCULADO}, 'M10', 'placeholder-nunca-usado', 'Com admin vinculado', ${POLICIAL}),
		       (${ADMIN_STANDALONE}, 'bootstrap', 'hash-admin', 'Admin do env', NULL);
	`);
});

function semearSessao(tipo: 'policial' | 'admin', usuarioId: number, token: string) {
	sqlite
		.prepare(
			`INSERT INTO sessoes (token, tipo, usuario_id, expires_at) VALUES (?, ?, ?, '2099-01-01T00:00:00.000Z')`
		)
		.run(token, tipo, usuarioId);
}

const tokensVivos = () =>
	(sqlite.prepare('SELECT token FROM sessoes ORDER BY token').all() as { token: string }[]).map(
		(r) => r.token
	);

describe('onde gravar a senha', () => {
	it('admin VINCULADO: a senha mora na linha do policial', async () => {
		// O login de admin vinculado lê `policiais.senha`. Gravar na linha admin
		// não muda nada — a senha nova não vale e a antiga continua valendo.
		const cred = await resolverCredencial(db, 'admin', ADMIN_VINCULADO);
		expect(cred.dono).toEqual({ tipo: 'policial', id: POLICIAL });
		expect(cred.vinculado).toBe(true);
	});

	it('admin STANDALONE: a senha é a da própria linha admin', async () => {
		const cred = await resolverCredencial(db, 'admin', ADMIN_STANDALONE);
		expect(cred.dono).toEqual({ tipo: 'admin', id: ADMIN_STANDALONE });
		expect(cred.vinculado).toBe(false);
	});

	it('policial: sempre a própria linha, tenha ou não conta admin', async () => {
		await expect(resolverCredencial(db, 'policial', POLICIAL)).resolves.toMatchObject({
			dono: { tipo: 'policial', id: POLICIAL }
		});
		await expect(resolverCredencial(db, 'policial', POLICIAL_SOLTO)).resolves.toMatchObject({
			dono: { tipo: 'policial', id: POLICIAL_SOLTO }
		});
	});

	it('id de admin inexistente não quebra — responde a própria linha', async () => {
		await expect(resolverCredencial(db, 'admin', 999)).resolves.toEqual({
			dono: { tipo: 'admin', id: 999 },
			identidades: [{ tipo: 'admin', id: 999 }],
			vinculado: false
		});
	});
});

describe('quais identidades a senha destrava', () => {
	it('vinculado: as duas, vindo por qualquer um dos lados', async () => {
		const porAdmin = await resolverCredencial(db, 'admin', ADMIN_VINCULADO);
		const porPolicial = await resolverCredencial(db, 'policial', POLICIAL);

		for (const cred of [porAdmin, porPolicial]) {
			expect(cred.identidades).toHaveLength(2);
			expect(cred.identidades).toEqual(
				expect.arrayContaining([
					{ tipo: 'policial', id: POLICIAL },
					{ tipo: 'admin', id: ADMIN_VINCULADO }
				])
			);
		}
	});

	it('não vinculado: só a própria', async () => {
		await expect(resolverCredencial(db, 'policial', POLICIAL_SOLTO)).resolves.toMatchObject({
			identidades: [{ tipo: 'policial', id: POLICIAL_SOLTO }]
		});
		await expect(resolverCredencial(db, 'admin', ADMIN_STANDALONE)).resolves.toMatchObject({
			identidades: [{ tipo: 'admin', id: ADMIN_STANDALONE }]
		});
	});
});

describe('revogação', () => {
	it('vinculado: derruba os DOIS cookies, entrando por qualquer lado', async () => {
		// O cenário que a troca de senha existia para resolver: cookie roubado do
		// modo usuário sobrevivendo à senha trocada no modo admin.
		semearSessao('admin', ADMIN_VINCULADO, 'tok-admin');
		semearSessao('policial', POLICIAL, 'tok-policial');
		semearSessao('policial', POLICIAL_SOLTO, 'tok-de-terceiro');

		await revogarSessoesDaCredencial(db, await resolverCredencial(db, 'admin', ADMIN_VINCULADO));
		expect(tokensVivos()).toEqual(['tok-de-terceiro']);
	});

	it('entrando pelo lado do policial, o mesmo resultado', async () => {
		semearSessao('admin', ADMIN_VINCULADO, 'tok-admin');
		semearSessao('policial', POLICIAL, 'tok-policial');

		await revogarSessoesDaCredencial(db, await resolverCredencial(db, 'policial', POLICIAL));
		expect(tokensVivos()).toEqual([]);
	});

	it('não vinculado: não encosta na sessão de outra pessoa', async () => {
		semearSessao('policial', POLICIAL_SOLTO, 'tok-solto');
		semearSessao('policial', POLICIAL, 'tok-outro');
		semearSessao('admin', ADMIN_VINCULADO, 'tok-admin');

		await revogarSessoesDaCredencial(db, await resolverCredencial(db, 'policial', POLICIAL_SOLTO));
		expect(tokensVivos()).toEqual(['tok-admin', 'tok-outro']);
	});

	it('admin standalone e policial de MESMO id não se confundem', async () => {
		// `administradores.id = 21` e `policiais.id = 21` seriam pessoas
		// diferentes; a revogação é por (tipo, id), nunca por id só.
		sqlite.exec(
			`INSERT INTO policiais (id, matricula, nome, cargo, lotacao, senha, ativo)
			 VALUES (${ADMIN_STANDALONE}, 'M21', 'Homônimo por id', 'OIP', 'DEL B', 'h', 1)`
		);
		semearSessao('admin', ADMIN_STANDALONE, 'tok-admin-21');
		semearSessao('policial', ADMIN_STANDALONE, 'tok-policial-21');

		await revogarSessoesDaCredencial(db, await resolverCredencial(db, 'admin', ADMIN_STANDALONE));
		expect(tokensVivos()).toEqual(['tok-policial-21']);
	});

	it('sem sessão nenhuma, não lança', async () => {
		await expect(
			revogarSessoesDaCredencial(db, await resolverCredencial(db, 'policial', POLICIAL))
		).resolves.toBeUndefined();
	});
});

describe('credencialDoUsuario (sem ida ao banco)', () => {
	it('sessão admin vinculada aponta para o policial', () => {
		expect(
			credencialDoUsuario({ tipo: 'admin', id: ADMIN_VINCULADO, adminPolicialId: POLICIAL })
		).toEqual({ tipo: 'policial', id: POLICIAL });
	});

	it('sessão admin standalone aponta para si', () => {
		expect(
			credencialDoUsuario({ tipo: 'admin', id: ADMIN_STANDALONE, adminPolicialId: null })
		).toEqual({ tipo: 'admin', id: ADMIN_STANDALONE });
	});

	it('sessão de policial aponta para si', () => {
		expect(credencialDoUsuario({ tipo: 'policial', id: POLICIAL })).toEqual({
			tipo: 'policial',
			id: POLICIAL
		});
	});
});
