import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Database } from '$lib/db';
import type { GiseEscala } from '../../schema';

// Mock do Drizzle: o helper usa db.select().from().innerJoin().innerJoin().where().limit().get().
// Construímos um chain mock que devolve um valor configurável de `membroResult`.
let membroResult: { id: number } | undefined = undefined;

const dbChain = {
	select: () => dbChain,
	from: () => dbChain,
	innerJoin: () => dbChain,
	where: () => dbChain,
	limit: () => dbChain,
	get: () => Promise.resolve(membroResult)
};

const fakeDb = dbChain as unknown as Database;

import { verificarPermissaoGise } from '../permissao';

function gise(overrides: Partial<GiseEscala> = {}): GiseEscala {
	return {
		id: 100,
		supervisor_id: 10,
		assessor_id: 11,
		seint1_id: 12,
		seint2_id: 13,
		data_inicio: '2026-01-01',
		data_fim: '2026-01-01',
		status: 'em_andamento',
		created_at: '2026-01-01T00:00:00Z',
		updated_at: '2026-01-01T00:00:00Z',
		...overrides
	} as GiseEscala;
}

function user(
	overrides: Partial<NonNullable<App.Locals['usuario']>> = {}
): NonNullable<App.Locals['usuario']> {
	return {
		id: 1,
		tipo: 'policial',
		nome: 'Fulano',
		primeiro_acesso: false,
		matricula: '00001',
		lotacao: 'DELEGACIA A',
		papel: null,
		papel_unidade_id: null,
		cargo: 'OIP',
		cpf: null,
		email: null,
		...overrides
	} as NonNullable<App.Locals['usuario']>;
}

describe('verificarPermissaoGise', () => {
	let getSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		membroResult = undefined;
		// vi.spyOn reusa instância — chamar mockClear() garante contagem por teste.
		getSpy = vi.spyOn(dbChain, 'get');
		getSpy.mockClear();
	});

	it('admin geral SEMPRE pode (sem query de membros)', async () => {
		const u = user({ tipo: 'admin' });
		const r = await verificarPermissaoGise(fakeDb, gise(), u);
		expect(r).toEqual({ permitido: true });
		expect(getSpy).not.toHaveBeenCalled();
	});

	it('admin seccional PARTICIPANTE (sua seccional está na GISE) pode', async () => {
		membroResult = { id: 1 }; // EXISTS em gise_seccionais retorna linha
		const u = user({ papel: 'admin_seccional', papel_unidade_id: 50 });
		const r = await verificarPermissaoGise(fakeDb, gise(), u);
		expect(r).toEqual({ permitido: true });
	});

	it('admin seccional NÃO participante (seccional fora da GISE) NÃO pode', async () => {
		membroResult = undefined; // nenhuma gise_seccional bate
		const u = user({ papel: 'admin_seccional', papel_unidade_id: 77 });
		const r = await verificarPermissaoGise(fakeDb, gise(), u);
		expect(r.permitido).toBe(false);
		expect(r.motivo).toMatch(/seccional/i);
	});

	it('admin seccional sem papel_unidade_id NÃO pode (sem query)', async () => {
		const u = user({ papel: 'admin_seccional', papel_unidade_id: null });
		const r = await verificarPermissaoGise(fakeDb, gise(), u);
		expect(r.permitido).toBe(false);
		expect(getSpy).not.toHaveBeenCalled();
	});

	it('admin unidade participante pode; não-participante não', async () => {
		membroResult = { id: 2 };
		const uPart = user({ papel: 'admin_unidade', papel_unidade_id: 60 });
		expect(await verificarPermissaoGise(fakeDb, gise(), uPart)).toEqual({ permitido: true });

		membroResult = undefined;
		const uNao = user({ papel: 'admin_unidade', papel_unidade_id: 61 });
		expect((await verificarPermissaoGise(fakeDb, gise(), uNao)).permitido).toBe(false);
	});

	it('supervisor designado pode (sem query de membros)', async () => {
		const u = user({ id: 10 });
		const r = await verificarPermissaoGise(fakeDb, gise({ supervisor_id: 10 }), u);
		expect(r).toEqual({ permitido: true });
		expect(getSpy).not.toHaveBeenCalled();
	});

	it('assessor / seint1 / seint2 podem (sem query de membros)', async () => {
		for (const role of ['assessor_id', 'seint1_id', 'seint2_id'] as const) {
			const u = user({ id: 99 });
			const r = await verificarPermissaoGise(
				fakeDb,
				gise({ [role]: 99 } as Partial<GiseEscala>),
				u
			);
			expect(r).toEqual({ permitido: true });
		}
	});

	it('policial que é membro de equipe da GISE pode (após query)', async () => {
		membroResult = { id: 555 };
		const u = user({ id: 42 });
		const r = await verificarPermissaoGise(fakeDb, gise(), u);
		expect(r).toEqual({ permitido: true });
	});

	it('policial de outra lotação sem nenhum vínculo NÃO pode', async () => {
		membroResult = undefined;
		const u = user({ id: 999, lotacao: 'OUTRA' });
		const r = await verificarPermissaoGise(fakeDb, gise(), u);
		expect(r.permitido).toBe(false);
		expect(r.motivo).toMatch(/Sem permiss/i);
	});

	it('policial NÃO admin com supervisor_id null não vira supervisor por acaso', async () => {
		// id=null/undefined no GISE não deve fazer match com user.id válido.
		membroResult = undefined;
		const u = user({ id: 1 });
		const r = await verificarPermissaoGise(
			fakeDb,
			gise({ supervisor_id: null, assessor_id: null, seint1_id: null, seint2_id: null }),
			u
		);
		expect(r.permitido).toBe(false);
	});

	it('membros endpoint só é consultado quando user é policial sem vínculo direto', async () => {
		// Para um policial que NÃO é admin, NÃO é quadro de supervisão, o helper
		// precisa consultar gise_membros — exatamente 1 query.
		membroResult = undefined;
		const u = user({ id: 999, lotacao: 'OUTRA' });
		await verificarPermissaoGise(fakeDb, gise(), u);
		expect(getSpy).toHaveBeenCalledTimes(1);
	});
});
