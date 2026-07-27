import { describe, it, expect } from 'vitest';
import { ehViolacaoUnique, mensagemComCausas } from '../db-errors';

/**
 * A cadeia abaixo foi capturada do D1 local (miniflare) ao inserir uma unidade
 * com nome repetido. O detalhe que importa: o texto "UNIQUE constraint failed"
 * NÃO aparece na mensagem de topo — só em `cause`. As rotas que testavam
 * `e.message.includes('UNIQUE')` devolviam 500 com o SQL cru em vez do 409.
 */
function erroDrizzleUniqueReal(): Error {
	const raiz = new Error(
		'UNIQUE constraint failed: unidades.nome: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_UNIQUE)'
	);
	const d1 = new Error(
		'D1_ERROR: UNIQUE constraint failed: unidades.nome: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_UNIQUE)',
		{ cause: raiz }
	);
	return new Error(
		'Failed query: insert into "unidades" ("id", "nome") values (null, ?)\nparams: Delegacia X',
		{ cause: d1 }
	);
}

describe('mensagemComCausas', () => {
	it('concatena a mensagem de topo com as das causas', () => {
		const msg = mensagemComCausas(erroDrizzleUniqueReal());
		expect(msg).toContain('Failed query');
		expect(msg).toContain('D1_ERROR');
		expect(msg).toContain('UNIQUE constraint failed');
	});

	it('respeita o limite de níveis e não entra em laço com causa circular', () => {
		const a = new Error('a');
		const b = new Error('b', { cause: a });
		(a as Error & { cause?: unknown }).cause = b;
		expect(mensagemComCausas(b, 3).split(' | ')).toHaveLength(3);
	});

	it('aceita valores que não são Error', () => {
		expect(mensagemComCausas('falha crua')).toBe('falha crua');
		expect(mensagemComCausas(null)).toBe('');
	});
});

describe('ehViolacaoUnique', () => {
	it('reconhece a violação escondida na cadeia de causas', () => {
		expect(ehViolacaoUnique(erroDrizzleUniqueReal())).toBe(true);
	});

	it('reconhece o erro cru do driver (sem embrulho do Drizzle)', () => {
		expect(ehViolacaoUnique(new Error('UNIQUE constraint failed: policiais.matricula'))).toBe(true);
	});

	it('não confunde outras falhas de banco', () => {
		expect(ehViolacaoUnique(new Error('D1_ERROR: no such column: nome'))).toBe(false);
		expect(ehViolacaoUnique(new Error('NOT NULL constraint failed: unidades.nome'))).toBe(false);
		expect(ehViolacaoUnique(undefined)).toBe(false);
	});
});
