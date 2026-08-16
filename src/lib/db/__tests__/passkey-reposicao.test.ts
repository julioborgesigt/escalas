/**
 * 2FA da reposição da chave — contra SQLite real.
 *
 * Uso único, amarre ao e-mail (I-1) e os dois canais independentes: um código
 * do institucional não autentica o pessoal. Primeiro cadastro não chega aqui.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { Database } from '$lib/db';
import { bancoMigrado, drizzleSobre } from './sqlite-migrado';
import {
	criarDesafioReposicao,
	consumirDesafioReposicao,
	consumirDoisCodigosReposicao,
	type RecusaReposicao
} from '../passkey-reposicao';
import type { DonoCredencial } from '../webauthn';

let db: Database;

const DONO: DonoCredencial = { tipo: 'policial', id: 42 };
const OUTRO: DonoCredencial = { tipo: 'policial', id: 99 };
const EMAIL_INST = 'fulano@pc.ce.gov.br';
const EMAIL_PESS = 'fulano@pessoal.com';

beforeEach(() => {
	db = drizzleSobre(bancoMigrado());
});

describe('consumirDesafioReposicao', () => {
	it('aceita o código certo uma vez e recusa a segunda', async () => {
		const id = await criarDesafioReposicao(db, DONO, 'institucional', '123456', EMAIL_INST);
		await expect(
			consumirDesafioReposicao(db, id, '123456', DONO, 'institucional', EMAIL_INST)
		).resolves.toEqual({ ok: true });
		await expect(
			consumirDesafioReposicao(db, id, '123456', DONO, 'institucional', EMAIL_INST)
		).resolves.toEqual({ ok: false, motivo: 'invalido' satisfies RecusaReposicao });
	});

	it('código errado não consome; e-mail divergente também recusa', async () => {
		const id = await criarDesafioReposicao(db, DONO, 'institucional', '123456', EMAIL_INST);
		await expect(
			consumirDesafioReposicao(db, id, '000000', DONO, 'institucional', EMAIL_INST)
		).resolves.toEqual({ ok: false, motivo: 'invalido' });
		await expect(
			consumirDesafioReposicao(db, id, '123456', DONO, 'institucional', 'outro@pc.ce.gov.br')
		).resolves.toEqual({ ok: false, motivo: 'invalido' });
		await expect(
			consumirDesafioReposicao(db, id, '123456', DONO, 'institucional', EMAIL_INST)
		).resolves.toEqual({ ok: true });
	});

	it('desafio de outra pessoa ou outro canal não serve', async () => {
		const id = await criarDesafioReposicao(db, DONO, 'institucional', '123456', EMAIL_INST);
		await expect(
			consumirDesafioReposicao(db, id, '123456', OUTRO, 'institucional', EMAIL_INST)
		).resolves.toEqual({ ok: false, motivo: 'invalido' });
		await expect(
			consumirDesafioReposicao(db, id, '123456', DONO, 'pessoal', EMAIL_INST)
		).resolves.toEqual({ ok: false, motivo: 'invalido' });
	});

	it('ausência de código ou desafio é recusa explícita', async () => {
		await expect(
			consumirDesafioReposicao(db, null, '123456', DONO, 'institucional', EMAIL_INST)
		).resolves.toEqual({ ok: false, motivo: 'ausente' });
	});
});

describe('consumirDoisCodigosReposicao', () => {
	it('os dois canais, os dois — um só não passa', async () => {
		const inst = await criarDesafioReposicao(db, DONO, 'institucional', '111111', EMAIL_INST);
		const pess = await criarDesafioReposicao(db, DONO, 'pessoal', '222222', EMAIL_PESS);

		await expect(
			consumirDoisCodigosReposicao(
				db,
				{
					desafioInstitucional: inst,
					codigoInstitucional: '111111',
					emailInstitucional: EMAIL_INST,
					emailPessoal: EMAIL_PESS
				},
				DONO
			)
		).resolves.toEqual({ ok: false, motivo: 'ausente' });

		await expect(
			consumirDoisCodigosReposicao(
				db,
				{
					desafioInstitucional: inst,
					codigoInstitucional: '111111',
					desafioPessoal: pess,
					codigoPessoal: '222222',
					emailInstitucional: EMAIL_INST,
					emailPessoal: EMAIL_PESS
				},
				DONO
			)
		).resolves.toEqual({ ok: true });
	});
});
