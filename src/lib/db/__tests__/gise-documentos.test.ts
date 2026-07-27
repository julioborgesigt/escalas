import { describe, it, expect, vi } from 'vitest';
import { salvarGiseDocumento } from '../gise/documentos';
import { salvarAssinaturaRelatorioGise } from '../gise/assinaturas';
import type { Database } from '../core';

/**
 * `salvarGiseDocumento` é um upsert: os mesmos campos vão no INSERT e no
 * UPDATE. Antes eles estavam escritos duas vezes, lado a lado — uma coluna
 * acrescentada só no INSERT sobreviveria à primeira assinatura e sumiria na
 * reassinatura, sem erro nenhum. Este teste trava os dois lados como iguais.
 */
function dbEspiao() {
	const capturado: { values?: Record<string, unknown>; set?: Record<string, unknown> } = {};
	const onConflictDoUpdate = vi.fn((cfg: { set: Record<string, unknown> }) => {
		capturado.set = cfg.set;
		return Promise.resolve();
	});
	const values = vi.fn((v: Record<string, unknown>) => {
		capturado.values = v;
		return { onConflictDoUpdate };
	});
	const db = { insert: vi.fn(() => ({ values })) } as unknown as Database;
	return { db, capturado };
}

async function salvar(db: Database) {
	return salvarGiseDocumento(
		db,
		7, // giseId
		'gise/7/escala.pdf',
		42,
		'FULANO DE TAL',
		'12345678901',
		'hash-verificacao',
		'data:image/png;base64,rubrica',
		'203.0.113.42',
		'Mozilla/5.0 (X11; Linux x86_64)',
		-3.7319,
		-38.5267,
		'gise/7/selfie.jpg',
		'sha256-do-arquivo',
		'fulano@pc.ce.gov.br',
		'servidor'
	);
}

describe('salvarGiseDocumento (upsert)', () => {
	it('grava os mesmos campos no INSERT e no UPDATE', async () => {
		const { db, capturado } = dbEspiao();
		await salvar(db);

		const insert = { ...capturado.values };
		const update = { ...capturado.set };

		// `gise_id` é o alvo do conflito e não pode ser reescrito;
		// `created_at` só existe no UPDATE (reassinatura renova o carimbo).
		expect(insert.gise_id).toBe(7);
		expect(update.gise_id).toBeUndefined();
		expect(update.created_at).toBeDefined();

		delete insert.gise_id;
		delete update.created_at;
		expect(Object.keys(update).sort()).toEqual(Object.keys(insert).sort());
		expect(update).toEqual(insert);
	});

	it('anonimiza o IP e reduz a precisão do GPS antes de gravar', async () => {
		const { db, capturado } = dbEspiao();
		await salvar(db);

		expect(capturado.values?.ip_address).toBe('203.0.113.0');
		expect(capturado.values?.latitude).toBe(-3.73);
		expect(capturado.values?.longitude).toBe(-38.53);
	});
});

describe('salvarAssinaturaRelatorioGise (upsert)', () => {
	it('grava os mesmos campos no INSERT e no UPDATE, sem reescrever a chave', async () => {
		const { db, capturado } = dbEspiao();
		await salvarAssinaturaRelatorioGise(db, {
			gise_id: 3,
			seccional_id: 9,
			tipo: 'extraordinario',
			assinante_id: 11,
			assinante_nome: 'BELTRANA',
			assinante_cpf: '98765432100',
			tipo_assinatura: 'serpro',
			ip_address: '198.51.100.7',
			user_agent: 'Mozilla/5.0',
			latitude: -3.731944,
			longitude: -38.526667,
			r2_key: 'gise/3/extra-9.pdf'
		});

		const insert = { ...capturado.values };
		const update = { ...capturado.set };

		// A trinca do conflito só aparece no INSERT.
		for (const chave of ['gise_id', 'seccional_id', 'tipo']) {
			expect(insert[chave]).toBeDefined();
			expect(update[chave]).toBeUndefined();
			delete insert[chave];
		}
		delete update.created_at;
		expect(update).toEqual(insert);

		// Normalizações aplicadas uma vez, valendo para os dois lados.
		expect(insert.ip_address).toBe('198.51.100.0');
		expect(insert.latitude).toBe(-3.73);
		expect(insert.tipo_carimbo_tempo).toBe('servidor');
	});
});
