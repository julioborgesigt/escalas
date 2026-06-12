import { describe, it, expect } from 'vitest';
import { verificarSaidaCompletaSeccional } from '../../db/gise/escalas-status';

/** Mock encadeável do query builder Drizzle terminando em get()/all(). */
function chain(terminal: { get?: unknown; all?: unknown }) {
	const c: Record<string, unknown> = {};
	for (const m of ['select', 'from', 'innerJoin', 'leftJoin', 'where']) c[m] = () => c;
	c.get = async () => terminal.get;
	c.all = async () => terminal.all;
	return c;
}

// Seccional normal: uma única query agregada {total, com_saida}.
function dbNormal(result: { total: number; com_saida: number } | undefined) {
	return { select: () => chain({ get: result }) } as never;
}

// Supervisão extra: 1ª select().get() = gise; 2ª select().all() = presenças.
function dbSup(gise: unknown, presencas: unknown[]) {
	let call = 0;
	return {
		select: () => {
			call++;
			return chain(call === 1 ? { get: gise } : { all: presencas });
		}
	} as never;
}

describe('verificarSaidaCompletaSeccional — seccional normal', () => {
	it('todos com saída → true', async () => {
		expect(
			await verificarSaidaCompletaSeccional(dbNormal({ total: 3, com_saida: 3 }), 1, 9, false)
		).toBe(true);
	});
	it('falta alguém sair → false', async () => {
		expect(
			await verificarSaidaCompletaSeccional(dbNormal({ total: 3, com_saida: 2 }), 1, 9, false)
		).toBe(false);
	});
	it('sem membros → false', async () => {
		expect(
			await verificarSaidaCompletaSeccional(dbNormal({ total: 0, com_saida: 0 }), 1, 9, false)
		).toBe(false);
	});
	it('resultado ausente → false', async () => {
		expect(await verificarSaidaCompletaSeccional(dbNormal(undefined), 1, 9, false)).toBe(false);
	});
});

describe('verificarSaidaCompletaSeccional — supervisão extra', () => {
	const gise = { supervisor_id: 1, assessor_id: 2, seint1_id: null, seint2_id: null };
	it('todo o quadro saiu → true', async () => {
		const db = dbSup(gise, [{ saida: 'x' }, { saida: 'y' }]);
		expect(await verificarSaidaCompletaSeccional(db, 1, 999, true)).toBe(true);
	});
	it('um do quadro sem saída → false', async () => {
		const db = dbSup(gise, [{ saida: 'x' }, { saida: null }]);
		expect(await verificarSaidaCompletaSeccional(db, 1, 999, true)).toBe(false);
	});
});
