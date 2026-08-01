/**
 * Testes da identidade da Política de Assinatura PA-AD-RB v2.3:
 *   - resolverHashPolitica (lado da assinatura): default oficial + override +
 *     rejeição do placeholder de zeros;
 *   - avaliarPoliticaAssinatura (lado da verificação): conformidade OID+hash.
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
	resolverHashPolitica,
	avaliarPoliticaAssinatura,
	OID_PA_AD_RB_V2_3,
	HASH_PA_AD_RB_V2_3_HEX
} from '../icp-policy';

describe('resolverHashPolitica (sigPolicyHash PA-AD-RB v2.3)', () => {
	afterEach(() => {
		delete process.env.PA_AD_RB_HASH_HEX;
	});

	it('usa o hash oficial embutido por padrão (sem env)', () => {
		delete process.env.PA_AD_RB_HASH_HEX;
		expect(resolverHashPolitica()).toBe(HASH_PA_AD_RB_V2_3_HEX);
		// Sanidade: é o hash interno reproduzido do artefato oficial.
		expect(HASH_PA_AD_RB_V2_3_HEX).toBe(
			'b16e88bbf77322a67995b79078778ed3d0ea7c88587b6f6d518b715e8f76a3d5'
		);
	});

	it('respeita override válido via env (64 hex, normalizado p/ minúsculas)', () => {
		process.env.PA_AD_RB_HASH_HEX = 'A'.repeat(64);
		expect(resolverHashPolitica()).toBe('a'.repeat(64));
	});

	it('rejeita o placeholder de zeros e cai no hash oficial', () => {
		process.env.PA_AD_RB_HASH_HEX = '0'.repeat(64);
		expect(resolverHashPolitica()).toBe(HASH_PA_AD_RB_V2_3_HEX);
	});

	it('ignora env malformado (não-hex / tamanho errado)', () => {
		process.env.PA_AD_RB_HASH_HEX = 'nao-eh-hash';
		expect(resolverHashPolitica()).toBe(HASH_PA_AD_RB_V2_3_HEX);
	});
});

describe('avaliarPoliticaAssinatura', () => {
	it('marca conforme quando OID + hash batem com a PA-AD-RB v2.3', () => {
		const r = avaliarPoliticaAssinatura(OID_PA_AD_RB_V2_3, HASH_PA_AD_RB_V2_3_HEX);
		expect(r).toEqual({
			presente: true,
			conforme: true,
			oid: OID_PA_AD_RB_V2_3,
			nome: 'PA-AD-RB v2.3'
		});
	});

	it('aceita hash em maiúsculas (normaliza)', () => {
		const r = avaliarPoliticaAssinatura(OID_PA_AD_RB_V2_3, HASH_PA_AD_RB_V2_3_HEX.toUpperCase());
		expect(r.conforme).toBe(true);
	});

	it('presente mas NÃO conforme quando o hash diverge', () => {
		const r = avaliarPoliticaAssinatura(OID_PA_AD_RB_V2_3, 'de'.repeat(32));
		expect(r.presente).toBe(true);
		expect(r.conforme).toBe(false);
		expect(r.nome).toBeUndefined();
	});

	it('presente mas NÃO conforme quando o OID é de outra política', () => {
		const r = avaliarPoliticaAssinatura('2.16.76.1.7.1.1.1', HASH_PA_AD_RB_V2_3_HEX);
		expect(r.presente).toBe(true);
		expect(r.conforme).toBe(false);
	});

	it('não presente quando não há OID de política', () => {
		expect(avaliarPoliticaAssinatura(undefined, undefined)).toEqual({
			presente: false,
			conforme: false
		});
	});
});
