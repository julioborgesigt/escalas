import { describe, it, expect, vi } from 'vitest';
import { salvarGiseDocumento } from '../gise/documentos';
import { salvarAssinaturaRelatorioGise, salvarTermoPresencaGise } from '../gise/assinaturas';
import {
	salvarDocumentoEscala,
	buscarDocumentoEscala,
	excluirDocumentoEscala
} from '../documentos';
import { bancoMigrado, drizzleSobre } from './sqlite-migrado';
import type { Database } from '../core';

/**
 * UNIQUE é a tranca (SEC-32). O segundo INSERT não grava. Reassinar exige
 * revogar (DELETE) antes — o upsert antigo sobrescrevia o documento jurídico.
 */
function dbEspiao() {
	const capturado: { values?: Record<string, unknown> } = {};
	const onConflictDoNothing = vi.fn(() => Promise.resolve({ meta: { changes: 1 } }));
	const values = vi.fn((v: Record<string, unknown>) => {
		capturado.values = v;
		return { onConflictDoNothing };
	});
	const db = { insert: vi.fn(() => ({ values })) } as unknown as Database;
	return { db, capturado };
}

describe('salvar* assinatura (insert, SEC-32)', () => {
	it('anonimiza IP e reduz GPS no INSERT da GISE', async () => {
		const { db, capturado } = dbEspiao();
		await salvarGiseDocumento(db, {
			giseId: 7,
			r2Key: 'gise/7/escala.pdf',
			assinanteId: 42,
			assinanteNome: 'FULANO DE TAL',
			assinanteCpf: '12345678901',
			verificacaoHash: 'hash-verificacao',
			ipAddress: '203.0.113.42',
			userAgent: 'Mozilla/5.0 (X11; Linux x86_64)',
			latitude: -3.7319,
			longitude: -38.5267
		});
		expect(capturado.values?.ip_address).toBe('203.0.113.0');
		expect(capturado.values?.latitude).toBe(-3.73);
		expect(capturado.values?.longitude).toBe(-38.53);
	});

	it('termo de presença grava opcionais ausentes como null explícito', async () => {
		const { db, capturado } = dbEspiao();
		await salvarTermoPresencaGise(db, {
			gise_id: 7,
			policial_id: 42,
			tipo: 'entrada',
			assinante_nome: 'FULANO DE TAL',
			ip_address: '203.0.113.42',
			latitude: -3.7319,
			longitude: -38.5267
		});
		expect(capturado.values?.ip_address).toBe('203.0.113.0');
		expect(capturado.values?.cert_issuer).toBeNull();
		expect(capturado.values?.webauthn_credential_id).toBeNull();
	});
});

describe('UNIQUE recusa o segundo INSERT (SEC-32)', () => {
	it('escala: segunda gravação não sobrescreve a primeira', async () => {
		const sqlite = bancoMigrado();
		const db = drizzleSobre(sqlite);
		sqlite.exec(
			`INSERT INTO escalas (id, titulo, cidade, data_inicio, data_fim)
			 VALUES (5, 'Plantão', 'Fortaleza', '2026-08-01', '2026-08-31');`
		);
		const a = await salvarDocumentoEscala(db, {
			escalaId: 5,
			r2Key: 'escalas/5/a.pdf',
			assinanteNome: 'CICRANO',
			verificacaoHash: 'hash-a'
		});
		const b = await salvarDocumentoEscala(db, {
			escalaId: 5,
			r2Key: 'escalas/5/b.pdf',
			assinanteNome: 'OUTRO',
			verificacaoHash: 'hash-b'
		});
		expect(a.gravado).toBe(true);
		expect(b.gravado).toBe(false);
		const row = await buscarDocumentoEscala(db, 5);
		expect(row?.r2_key).toBe('escalas/5/a.pdf');
		expect(row?.verificacao_hash).toBe('hash-a');
	});

	it('escala: depois de revogar, o INSERT novo grava', async () => {
		const sqlite = bancoMigrado();
		const db = drizzleSobre(sqlite);
		sqlite.exec(
			`INSERT INTO escalas (id, titulo, cidade, data_inicio, data_fim)
			 VALUES (5, 'Plantão', 'Fortaleza', '2026-08-01', '2026-08-31');`
		);
		await salvarDocumentoEscala(db, {
			escalaId: 5,
			r2Key: 'escalas/5/a.pdf',
			assinanteNome: 'CICRANO',
			verificacaoHash: 'hash-a'
		});
		await excluirDocumentoEscala(db, 5);
		const c = await salvarDocumentoEscala(db, {
			escalaId: 5,
			r2Key: 'escalas/5/c.pdf',
			assinanteNome: 'CICRANO',
			verificacaoHash: 'hash-c'
		});
		expect(c.gravado).toBe(true);
		expect((await buscarDocumentoEscala(db, 5))?.verificacao_hash).toBe('hash-c');
	});

	it('relatório extra: segunda gravação não sobrescreve', async () => {
		const sqlite = bancoMigrado();
		const db = drizzleSobre(sqlite);
		sqlite.exec(`
			INSERT INTO unidades (id, nome, tipo) VALUES (9, 'SEC A', 'seccional');
			INSERT INTO gise_escalas (id, data_inicio, status) VALUES (3, '2026-08-10', 'em_andamento');
		`);
		const a = await salvarAssinaturaRelatorioGise(db, {
			gise_id: 3,
			seccional_id: 9,
			tipo: 'extraordinario',
			assinante_nome: 'BELTRANA',
			tipo_assinatura: 'serpro',
			verification_hash: 'hash-a'
		});
		const b = await salvarAssinaturaRelatorioGise(db, {
			gise_id: 3,
			seccional_id: 9,
			tipo: 'extraordinario',
			assinante_nome: 'OUTRA',
			tipo_assinatura: 'simples',
			verification_hash: 'hash-b'
		});
		expect(a.gravado).toBe(true);
		expect(b.gravado).toBe(false);
	});
});
