/**
 * USO ÚNICO do token de redefinição de senha, contra um SQLite REAL.
 *
 * O achado FLW-AUTH-004: `verificarTokenRedefinicao` LIA o token e
 * `marcarTokenRedefinicaoUsado` o marcava depois, num `UPDATE` incondicional.
 * Entre a leitura e a marcação cabe outra requisição — e ela lê o mesmo token
 * ainda com `usado = 0`. Duas trocas de senha a partir de um único link, o que
 * derruba a premissa do fluxo inteiro: quem interceptou o e-mail pode redefinir
 * a senha DEPOIS do dono, sem que o link "já usado" o denuncie.
 *
 * O comentário do próprio caller dizia "previne race condition". Não prevenia:
 * mudava a ordem, o que encurta a janela e não a fecha.
 *
 * A correção é `consumirTokenRedefinicao`, um `UPDATE ... WHERE usado = 0 AND
 * expires_at > agora RETURNING`: quem alterar a linha ganha, todo o resto perde.
 * Os testes abaixo rodam contra o banco de verdade porque é a ATOMICIDADE do
 * SQL que está sob teste — um mock do query builder provaria só que o código
 * chama o que já sabemos que chama.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/sqlite-proxy';
import type { Database } from '$lib/db';
import {
	criarTokenRedefinicao,
	consumirTokenRedefinicao,
	verificarTokenRedefinicao
} from '$lib/auth';

const DIR_MIGRACOES = join(process.cwd(), 'migrations');

function bancoMigrado(): DatabaseSync {
	const db = new DatabaseSync(':memory:');
	for (const arquivo of readdirSync(DIR_MIGRACOES)
		.filter((f) => f.endsWith('.sql'))
		.sort()) {
		const sql = readFileSync(join(DIR_MIGRACOES, arquivo), 'utf8');
		for (const stmt of sql.split('--> statement-breakpoint')) {
			const s = stmt.trim();
			if (s) db.exec(s);
		}
	}
	return db;
}

let sqlite: DatabaseSync;
let db: Database;

beforeEach(() => {
	vi.useRealTimers();
	sqlite = bancoMigrado();
	db = drizzle(async (sql, params, method) => {
		const stmt = sqlite.prepare(sql);
		if (method === 'run') {
			const r = stmt.run(...(params as never[]));
			return { rows: [], rowsAffected: Number(r.changes ?? 0) } as never;
		}
		const linhas = stmt.all(...(params as never[])) as Record<string, unknown>[];
		const arrays = linhas.map((l) => Object.values(l));
		return { rows: method === 'get' ? (arrays[0] ?? []) : arrays };
	}) as unknown as Database;
});

/** Quantos tokens não usados restam — o estado que a corrida corrompe. */
function naoUsados(): number {
	return (
		sqlite.prepare('SELECT COUNT(*) AS n FROM reset_senha_tokens WHERE usado = 0').get() as {
			n: number;
		}
	).n;
}

describe('consumirTokenRedefinicao', () => {
	it('devolve o usuário na primeira vez', async () => {
		const token = await criarTokenRedefinicao(db, 'policial', 42);
		await expect(consumirTokenRedefinicao(db, token)).resolves.toEqual({
			tipo: 'policial',
			usuarioId: 42
		});
		expect(naoUsados()).toBe(0);
	});

	it('a SEGUNDA vez falha — é isto que "uso único" significa', async () => {
		const token = await criarTokenRedefinicao(db, 'admin', 7);
		await consumirTokenRedefinicao(db, token);
		await expect(consumirTokenRedefinicao(db, token)).resolves.toBe('invalido');
	});

	it('duas requisições CONCORRENTES: exatamente uma ganha', async () => {
		// O caso que a implementação antiga perdia. Sem `WHERE usado = 0`, as
		// duas liam a linha íntegra e as duas seguiam para trocar a senha.
		const token = await criarTokenRedefinicao(db, 'policial', 99);

		const resultados = await Promise.all([
			consumirTokenRedefinicao(db, token),
			consumirTokenRedefinicao(db, token),
			consumirTokenRedefinicao(db, token)
		]);

		const vencedores = resultados.filter((r) => typeof r !== 'string');
		expect(vencedores).toEqual([{ tipo: 'policial', usuarioId: 99 }]);
		expect(resultados.filter((r) => r === 'invalido')).toHaveLength(2);
	});

	it('token expirado NÃO é consumido, e a mensagem diz por quê', async () => {
		const token = await criarTokenRedefinicao(db, 'policial', 5);
		sqlite
			.prepare('UPDATE reset_senha_tokens SET expires_at = ?')
			.run(new Date(Date.now() - 60_000).toISOString());

		await expect(consumirTokenRedefinicao(db, token)).resolves.toBe('expirado');
		// Continua `usado = 0`: quem pede um link novo não deixa lixo marcado, e
		// o usuário recebe "expirou, solicite outro" em vez de "inválido".
		expect(naoUsados()).toBe(1);
	});

	it('token inexistente é inválido, sem lançar', async () => {
		await expect(consumirTokenRedefinicao(db, 'a'.repeat(64))).resolves.toBe('invalido');
	});

	it('consumir UM token não afeta os outros', async () => {
		const t1 = await criarTokenRedefinicao(db, 'policial', 1);
		await criarTokenRedefinicao(db, 'policial', 2);

		await consumirTokenRedefinicao(db, t1);

		expect(naoUsados()).toBe(1);
	});

	it('o token em claro nunca chega ao banco', async () => {
		// Mesma garantia de `criarSessao`: a linha guarda só o `sha256:`.
		const token = await criarTokenRedefinicao(db, 'admin', 3);
		const guardado = (
			sqlite.prepare('SELECT token FROM reset_senha_tokens').get() as { token: string }
		).token;
		expect(guardado).not.toBe(token);
		expect(guardado.startsWith('sha256:')).toBe(true);
	});
});

describe('verificarTokenRedefinicao (leitura, sem consumir)', () => {
	it('valida sem marcar — é o que a tela de load usa', async () => {
		const token = await criarTokenRedefinicao(db, 'policial', 11);

		await expect(verificarTokenRedefinicao(db, token)).resolves.toEqual({
			tipo: 'policial',
			usuarioId: 11
		});
		// Abrir a página duas vezes não pode queimar o link.
		await expect(verificarTokenRedefinicao(db, token)).resolves.toEqual({
			tipo: 'policial',
			usuarioId: 11
		});
		expect(naoUsados()).toBe(1);
	});

	it('depois de consumido, a leitura passa a dizer inválido', async () => {
		const token = await criarTokenRedefinicao(db, 'policial', 11);
		await consumirTokenRedefinicao(db, token);
		await expect(verificarTokenRedefinicao(db, token)).resolves.toBe('invalido');
	});
});
