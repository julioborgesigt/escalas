/**
 * Testes das decisões puras do finalizador CAdES:
 *   - exigirTsa: parsing da flag EXIGIR_TSA_QUALIFICADA (porta de rigor);
 *   - rotuloDoCarimbo: classificação act_icp/tsa_externa e DEGRADAÇÃO para
 *     'servidor' quando o TST não é verificável (robustez — não bloqueia a
 *     assinatura; vide gap A).
 *
 * O trust store é mockado apenas para satisfazer o import transitivo (os
 * helpers sob teste são puros e não o consultam).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../icp-brasil/trust-store', () => ({
	loadTrustStore: () => ({ disponivel: false, roots: [], intermediates: [], caStore: undefined }),
	trustStoreRequerido: () => false
}));

import { exigirTsa, rotuloDoCarimbo } from '../cades-finalizer';

describe('exigirTsa', () => {
	beforeEach(() => {
		delete process.env.EXIGIR_TSA_QUALIFICADA;
	});
	afterEach(() => {
		delete process.env.EXIGIR_TSA_QUALIFICADA;
	});

	it('truthy: 1/true/yes/on (case-insensitive, com trim)', () => {
		for (const v of ['1', 'true', 'TRUE', 'yes', 'on', 'On ']) {
			expect(exigirTsa({ EXIGIR_TSA_QUALIFICADA: v })).toBe(true);
		}
	});

	it('falsy: vazio/0/false/no/ausente', () => {
		for (const v of ['', '0', 'false', 'no', 'qualquer']) {
			expect(exigirTsa({ EXIGIR_TSA_QUALIFICADA: v })).toBe(false);
		}
		expect(exigirTsa({})).toBe(false);
		expect(exigirTsa(undefined)).toBe(false);
	});
});

describe('rotuloDoCarimbo', () => {
	it('null (TST não verificável) → servidor: degrada e NÃO bloqueia', () => {
		expect(rotuloDoCarimbo(null)).toBe('servidor');
	});

	it('classe "icp" → act_icp', () => {
		expect(rotuloDoCarimbo({ momento: '2026-01-01T00:00:00.000Z', classe: 'icp' })).toBe('act_icp');
	});

	it('classe "externa" (ex.: DigiCert) → tsa_externa', () => {
		expect(rotuloDoCarimbo({ momento: '2026-01-01T00:00:00.000Z', classe: 'externa' })).toBe(
			'tsa_externa'
		);
	});
});
