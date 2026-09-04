/**
 * A FORÇA do encadeamento, reportada — o que `ok: true` vale.
 *
 * A cadeia usa HMAC-SHA256 quando `AUDIT_CHAIN_KEY` existe e SHA-256 puro quando
 * não. A diferença é material: sem a chave, quem tem escrita no banco reescreve
 * a cauda inteira e produz uma cadeia que FECHA — a trilha passa a detectar
 * adulteração acidental e nada mais.
 *
 * `.env.example` e `DEPLOY.md` explicam isso com precisão. O que faltava era
 * runtime: `verificarIntegridadeAudit` devolvia `ok: true` sem dizer em que modo
 * estava, e o console reportava "Cadeia íntegra" — verdade sobre o elo, silêncio
 * sobre o valor da garantia. Um deploy que nunca definiu a chave rodava forjável
 * e ninguém descobriria até uma perícia.
 *
 * A tag por linha (`h:`/`s:`) sempre soube a resposta; ela só não era somada.
 *
 * Nota: PERDER a chave depois de adotá-la já era detectado — a verificação falha
 * com "linha usa HMAC e AUDIT_CHAIN_KEY não está configurada". O caso cego era
 * NUNCA tê-la definido.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { Database } from '$lib/db';
import { bancoMigrado, drizzleSobre } from './sqlite-migrado';
import { auditar, verificarIntegridadeAudit } from '../audit';

const CHAVE = 'a'.repeat(64); // 32 bytes em hex
const OUTRA = 'b'.repeat(64);

let db: Database;

beforeEach(() => {
	db = drizzleSobre(bancoMigrado());
});

async function gravar(n: number, env?: { AUDIT_CHAIN_KEY?: string }) {
	for (let i = 0; i < n; i++) {
		await auditar(
			db,
			{
				acao: 'editar_escala',
				usuario: { id: 1, nome: 'Admin', tipo: 'admin' },
				entidade: 'escala',
				entidade_id: i + 1,
				detalhes: `evento ${i + 1}`
			},
			env ? { env } : undefined
		);
	}
}

describe('verificarIntegridadeAudit — reporta o modo da cadeia', () => {
	it('sem AUDIT_CHAIN_KEY: modo `sha256` e a cadeia AINDA fecha', async () => {
		await gravar(4);
		const r = await verificarIntegridadeAudit(db);
		// É este par que constitui o achado: íntegra E forjável.
		expect(r.ok).toBe(true);
		expect(r.modoCadeia).toBe('sha256');
		expect(r.encadeamento).toEqual({ hmac: 0, sha256: 4 });
	});

	it('com AUDIT_CHAIN_KEY: modo `hmac`', async () => {
		await gravar(3, { AUDIT_CHAIN_KEY: CHAVE });
		const r = await verificarIntegridadeAudit(db, { AUDIT_CHAIN_KEY: CHAVE });
		expect(r.ok).toBe(true);
		expect(r.modoCadeia).toBe('hmac');
		expect(r.encadeamento).toEqual({ hmac: 3, sha256: 0 });
	});

	it('chave adotada no MEIO da vida do log: modo `misto`, com a contagem de cada metade', async () => {
		await gravar(2);
		await gravar(3, { AUDIT_CHAIN_KEY: CHAVE });
		const r = await verificarIntegridadeAudit(db, { AUDIT_CHAIN_KEY: CHAVE });
		expect(r.ok).toBe(true);
		expect(r.modoCadeia).toBe('misto');
		expect(r.encadeamento).toEqual({ hmac: 3, sha256: 2 });
	});

	it('trilha vazia: modo `vazia`, não `sha256` — ausência não é fraqueza', async () => {
		const r = await verificarIntegridadeAudit(db);
		expect(r.ok).toBe(true);
		expect(r.modoCadeia).toBe('vazia');
		expect(r.encadeamento).toEqual({ hmac: 0, sha256: 0 });
	});

	it('o modo acompanha o resultado de FALHA também — as duas informações são necessárias', async () => {
		await gravar(3, { AUDIT_CHAIN_KEY: CHAVE });
		// Perder a chave é o caso que já era detectado; aqui se confirma que a
		// resposta de falha também diz em que modo a trilha estava.
		const r = await verificarIntegridadeAudit(db);
		expect(r.ok).toBe(false);
		expect(r.problema).toMatch(/AUDIT_CHAIN_KEY/);
		expect(r.modoCadeia).toBe('hmac');
	});

	it('chave TROCADA é adulteração para efeito de verificação', async () => {
		await gravar(3, { AUDIT_CHAIN_KEY: CHAVE });
		const r = await verificarIntegridadeAudit(db, { AUDIT_CHAIN_KEY: OUTRA });
		expect(r.ok).toBe(false);
		expect(r.modoCadeia).toBe('hmac');
	});
});
