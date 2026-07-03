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

import { exigirTsa, rotuloDoCarimbo, avaliarConfiguracaoTsa } from '../cades-finalizer';

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

describe('avaliarConfiguracaoTsa', () => {
	beforeEach(() => {
		delete process.env.EXIGIR_TSA_QUALIFICADA;
		delete process.env.TSA_URL;
	});
	afterEach(() => {
		delete process.env.EXIGIR_TSA_QUALIFICADA;
		delete process.env.TSA_URL;
	});

	it('flag desligado: sempre coerente (não avalia TSA_URL)', () => {
		expect(avaliarConfiguracaoTsa({ TSA_URL: 'http://timestamp.digicert.com' }).coerente).toBe(
			true
		);
		expect(avaliarConfiguracaoTsa({}).coerente).toBe(true);
	});

	it('armadilha: flag ligado + DigiCert (não-ICP) → incoerente com motivo', () => {
		const r = avaliarConfiguracaoTsa({
			EXIGIR_TSA_QUALIFICADA: '1',
			TSA_URL: 'http://timestamp.digicert.com'
		});
		expect(r.coerente).toBe(false);
		expect(r.motivo).toMatch(/digicert\.com/);
		expect(r.motivo).toMatch(/act_icp|ACT/);
	});

	it('armadilha: flag ligado + subdomínio de TSA não-ICP → incoerente', () => {
		const r = avaliarConfiguracaoTsa({
			EXIGIR_TSA_QUALIFICADA: 'on',
			TSA_URL: 'https://sub.freetsa.org/tsr'
		});
		expect(r.coerente).toBe(false);
	});

	it('flag ligado + TSA_URL vazia → incoerente (rejeitaria tudo)', () => {
		const r = avaliarConfiguracaoTsa({ EXIGIR_TSA_QUALIFICADA: '1', TSA_URL: '' });
		expect(r.coerente).toBe(false);
		expect(r.motivo).toMatch(/não está configurada/);
	});

	it('flag ligado + TSA_URL inválida → incoerente', () => {
		const r = avaliarConfiguracaoTsa({ EXIGIR_TSA_QUALIFICADA: '1', TSA_URL: 'não-é-url' });
		expect(r.coerente).toBe(false);
		expect(r.motivo).toMatch(/inválida/);
	});

	it('flag ligado + ACT ICP desconhecida (host não listado) → coerente (sem falso-positivo)', () => {
		// Não sabemos verificar se é ICP sem contatar; ACT legítima não deve
		// ser acusada. O 422 real (se o carimbo não vier act_icp) traz a mensagem
		// genérica — este guard só acusa hosts não-ICP conhecidos.
		const r = avaliarConfiguracaoTsa({
			EXIGIR_TSA_QUALIFICADA: '1',
			TSA_URL: 'https://tsa.soluti.com.br/tsa'
		});
		expect(r.coerente).toBe(true);
	});
});
