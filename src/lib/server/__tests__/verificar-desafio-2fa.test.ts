import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { verificarDesafio2FA } from '../../auth';

/**
 * Regra de reutilização do código 2FA (assinatura em lote).
 * `markUsed: false` mantém o desafio válido até expirar; o default (true)
 * consome no primeiro sucesso (login/reset).
 */

// Hash que `hashCodigo2FA(codigo, '')` produz: SHA-256(codigo) em hex.
function hashCodigo(codigo: string): string {
	return createHash('sha256').update(codigo).digest('hex');
}

function makeDb(row: Record<string, unknown> | undefined) {
	const state = { row };
	return {
		select: () => ({ from: () => ({ where: () => ({ get: async () => state.row }) }) }),
		update: () => ({
			set: (vals: Record<string, unknown>) => ({
				where: async () => {
					if (state.row) Object.assign(state.row, vals);
				}
			})
		})
	} as never;
}

function novoDesafio() {
	return {
		id: 1,
		desafio_id: 'abc',
		tipo: 'assinatura',
		usuario_id: 7,
		codigo: hashCodigo('123456'),
		usado: 0,
		tentativas: 0,
		expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString()
	};
}

describe('verificarDesafio2FA — markUsed', () => {
	it('default (uso único): consome o desafio — 2ª verificação falha', async () => {
		const db = makeDb(novoDesafio());
		const r1 = await verificarDesafio2FA(db, 'abc', '123456', ['assinatura']);
		expect(r1).toEqual({ tipo: 'assinatura', usuarioId: 7 });
		const r2 = await verificarDesafio2FA(db, 'abc', '123456', ['assinatura']);
		expect(r2).toBeNull();
	});

	it('markUsed:false (lote): NÃO consome — múltiplas verificações sucedem', async () => {
		const db = makeDb(novoDesafio());
		const opts = { markUsed: false };
		const r1 = await verificarDesafio2FA(db, 'abc', '123456', ['assinatura'], '', opts);
		expect(r1).toEqual({ tipo: 'assinatura', usuarioId: 7 });
		const r2 = await verificarDesafio2FA(db, 'abc', '123456', ['assinatura'], '', opts);
		expect(r2).toEqual({ tipo: 'assinatura', usuarioId: 7 });
		const r3 = await verificarDesafio2FA(db, 'abc', '123456', ['assinatura'], '', opts);
		expect(r3).toEqual({ tipo: 'assinatura', usuarioId: 7 });
	});

	it('código errado falha mesmo com markUsed:false', async () => {
		const db = makeDb(novoDesafio());
		const r = await verificarDesafio2FA(db, 'abc', '000000', ['assinatura'], '', {
			markUsed: false
		});
		expect(r).toBeNull();
	});

	it('desafio expirado é rejeitado', async () => {
		const row = novoDesafio();
		row.expires_at = new Date(Date.now() - 1000).toISOString();
		const db = makeDb(row);
		const r = await verificarDesafio2FA(db, 'abc', '123456', ['assinatura'], '', {
			markUsed: false
		});
		expect(r).toBe('expirado');
	});
});
