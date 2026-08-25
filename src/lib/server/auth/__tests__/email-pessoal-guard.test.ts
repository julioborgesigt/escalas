/**
 * Testes da guarda de reautenticação para troca de e-mail pessoal — achado L-1
 * da auditoria de segurança 2026-07-10.
 *
 * Garante que:
 *   - 1º cadastro (sem e-mail pessoal atual) NÃO exige senha;
 *   - `primeiro_acesso` NÃO exige senha mesmo com e-mail já cadastrado
 *     (onboarding: a senha ainda está sendo definida);
 *   - troca de e-mail existente exige senha (inclusive para ADMIN — o furo do L-1);
 *   - senha ausente / incorreta são distinguidas e a incorreta grava tentativa
 *     (throttle) sem conceder;
 *   - excesso de tentativas bloqueia (429) sem chegar a verificar a senha.
 *
 * Harness sem better-sqlite3: `fakeDb` responde por tabela, distinguindo o
 * SELECT de contagem (thenable) do lookup (`.get()`).
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { administradores, policiais, recoveryAttempts } from '$lib/server/schema';
import { hashSenha } from '$lib/auth';
import type { Database } from '$lib/db';
import { exigirSenhaParaTrocaEmailPessoal } from '../email-pessoal-guard';

const SENHA = 'SenhaForte1';
let senhaHash: string;
beforeAll(async () => {
	senhaHash = await hashSenha(SENHA);
});

type Row = Record<string, unknown>;

/**
 * `fakeDb`:
 *  - policiais/administradores → devolve a linha injetada (`.get()`);
 *  - recoveryAttempts (count) → devolve `[{ n: tentativas }]` (thenable);
 *  - insert (registrar tentativa) → conta chamadas em `inserts`.
 */
function fakeDb(opts: {
	policial?: Row;
	admin?: Row;
	tentativas?: number;
	inserts: { count: number };
}): Database {
	const select = (fields?: Record<string, unknown>) => ({
		from: (table: unknown) => ({
			where: () => {
				const isCount = !!fields && 'n' in fields;
				return {
					get: async () => {
						if (table === policiais) return opts.policial;
						if (table === administradores) return opts.admin;
						return undefined;
					},
					then: (resolve: (v: Row[]) => unknown, reject: (e: unknown) => unknown) =>
						Promise.resolve(isCount ? [{ n: opts.tentativas ?? 0 }] : ([] as Row[])).then(
							resolve,
							reject
						)
				};
			}
		})
	});
	const insert = (table: unknown) => ({
		values: async () => {
			if (table === recoveryAttempts) opts.inserts.count++;
			return undefined;
		}
	});
	return { select, insert } as unknown as Database;
}

const policialLogado = {
	id: 7,
	tipo: 'policial' as const,
	nome: 'Fulano',
	primeiro_acesso: false
};
const adminLogado = {
	id: 3,
	tipo: 'admin' as const,
	nome: 'Admin',
	primeiro_acesso: false
};

describe('exigirSenhaParaTrocaEmailPessoal', () => {
	it('1º cadastro (sem e-mail atual) não exige senha', async () => {
		const inserts = { count: 0 };
		const db = fakeDb({ policial: { email_pessoal: null, senha: senhaHash }, inserts });
		const r = await exigirSenhaParaTrocaEmailPessoal(db, policialLogado, undefined, undefined);
		expect(r).toEqual({ ok: true, trocaDeEmailExistente: false });
		expect(inserts.count).toBe(0);
	});

	it('primeiro_acesso com e-mail já cadastrado não exige senha', async () => {
		const inserts = { count: 0 };
		const db = fakeDb({ policial: { email_pessoal: 'a@b.com', senha: senhaHash }, inserts });
		const r = await exigirSenhaParaTrocaEmailPessoal(
			db,
			{ ...policialLogado, primeiro_acesso: true },
			undefined,
			undefined
		);
		expect(r).toEqual({ ok: true, trocaDeEmailExistente: true });
		expect(inserts.count).toBe(0);
	});

	it('troca com e-mail existente e senha ausente → senha_ausente', async () => {
		const inserts = { count: 0 };
		const db = fakeDb({ policial: { email_pessoal: 'a@b.com', senha: senhaHash }, inserts });
		const r = await exigirSenhaParaTrocaEmailPessoal(db, policialLogado, undefined, undefined);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.erro).toBe('senha_ausente');
	});

	it('troca com senha correta → ok', async () => {
		const inserts = { count: 0 };
		const db = fakeDb({ policial: { email_pessoal: 'a@b.com', senha: senhaHash }, inserts });
		const r = await exigirSenhaParaTrocaEmailPessoal(db, policialLogado, SENHA, undefined);
		expect(r).toEqual({ ok: true, trocaDeEmailExistente: true });
		expect(inserts.count).toBe(0); // sucesso não grava tentativa
	});

	it('troca com senha incorreta → senha_incorreta e grava tentativa (throttle)', async () => {
		const inserts = { count: 0 };
		const db = fakeDb({ policial: { email_pessoal: 'a@b.com', senha: senhaHash }, inserts });
		const r = await exigirSenhaParaTrocaEmailPessoal(db, policialLogado, 'errada', undefined);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.erro).toBe('senha_incorreta');
		expect(inserts.count).toBe(1);
	});

	it('ADMIN com e-mail existente TAMBÉM exige senha (fecha o furo do L-1)', async () => {
		const inserts = { count: 0 };
		const db = fakeDb({ admin: { email_pessoal: 'a@b.com', senha: senhaHash }, inserts });
		const semSenha = await exigirSenhaParaTrocaEmailPessoal(db, adminLogado, undefined, undefined);
		expect(semSenha.ok).toBe(false);
		if (!semSenha.ok) expect(semSenha.erro).toBe('senha_ausente');

		const comSenha = await exigirSenhaParaTrocaEmailPessoal(db, adminLogado, SENHA, undefined);
		expect(comSenha).toEqual({ ok: true, trocaDeEmailExistente: true });
	});

	it('bloqueia (429) após exceder o teto de tentativas, sem verificar a senha', async () => {
		const inserts = { count: 0 };
		const db = fakeDb({
			policial: { email_pessoal: 'a@b.com', senha: senhaHash },
			tentativas: 5,
			inserts
		});
		// Mesmo com a senha CORRETA, o bloqueio precede a verificação.
		const r = await exigirSenhaParaTrocaEmailPessoal(db, policialLogado, SENHA, undefined);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.erro).toBe('bloqueado');
		expect(inserts.count).toBe(0);
	});
});
