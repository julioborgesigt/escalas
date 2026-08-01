/**
 * Testes do verificador de TimeStampToken (RFC 3161) — gap (A).
 *
 * Usa um TimeStampToken REAL emitido pela DigiCert (TSA pública, gratuita,
 * NÃO-ICP) como fixture, capturado sobre `SHA-256(SIG_VALUE)`. Assim os testes
 * exercitam criptografia real (assinatura RSA-4096 da TSA, messageImprint,
 * messageDigest) sem acesso à rede.
 *
 * O trust store ICP-Brasil é MOCKADO para controlar de forma determinística o
 * ramo de classificação (icp vs externa) e para não depender do import `?raw`
 * dos PEMs sob vitest.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import forge from 'node-forge';
import { readFileSync } from 'node:fs';
import type { TrustStore } from '../icp-brasil/trust-store';

vi.mock('../icp-brasil/trust-store', () => ({
	loadTrustStore: vi.fn(),
	trustStoreRequerido: vi.fn(() => false)
}));

import { verificarTimestampToken, parseCms } from '../pdf-verification';
import { loadTrustStore } from '../icp-brasil/trust-store';

// signatureValue cujo SHA-256 foi carimbado pela DigiCert ao gerar o fixture.
const SIG_VALUE = 'fixture-signature-value-gap-a';

const b64 = readFileSync(new URL('./fixtures/digicert-tst.b64', import.meta.url), 'utf8').trim();
const tokenBin = Buffer.from(b64, 'base64').toString('binary');
const tokenBytes = Uint8Array.from(tokenBin, (c) => c.charCodeAt(0));

function tokenAsn1(): forge.asn1.Asn1 {
	return forge.asn1.fromDer(forge.util.createBuffer(tokenBin));
}

function makeStore(caStore: forge.pki.CAStore, roots: forge.pki.Certificate[] = []): TrustStore {
	return { disponivel: true, roots, intermediates: [], caStore };
}

beforeEach(() => {
	// Default: trust store sem a cadeia da DigiCert → qualquer TST não-ICP.
	vi.mocked(loadTrustStore).mockReturnValue(makeStore(forge.pki.createCaStore([])));
});

describe('verificarTimestampToken', () => {
	it('verifica a assinatura da TSA e classifica DigiCert (não-ICP) como "externa"', async () => {
		const r = await verificarTimestampToken(tokenAsn1(), SIG_VALUE);
		expect(r).not.toBeNull();
		expect(r!.classe).toBe('externa');
		// genTime do fixture: 2026-05-29.
		expect(r!.momento).toContain('2026-05-29');
	});

	it('rejeita (null) quando o signatureValue não bate com o messageImprint', async () => {
		const r = await verificarTimestampToken(tokenAsn1(), 'signatureValue-errado');
		expect(r).toBeNull();
	});

	it('rejeita (null) quando a assinatura da TSA está corrompida', async () => {
		// Corrompe bytes no fim do DER (dentro da assinatura RSA do SignerInfo),
		// preservando tags/lengths para que o ASN.1 ainda parseie.
		const corrompido = tokenBytes.slice();
		corrompido[corrompido.length - 6] ^= 0xff;
		let bin = '';
		for (const x of corrompido) bin += String.fromCharCode(x);
		const asn1 = forge.asn1.fromDer(forge.util.createBuffer(bin));
		const r = await verificarTimestampToken(asn1, SIG_VALUE);
		expect(r).toBeNull();
	});

	it('classifica como "icp" quando a cadeia da TSA encadeia até o trust store', async () => {
		// Simula uma ACT credenciada: confia na própria cadeia embutida no token.
		const parsed = parseCms(tokenBytes);
		expect(parsed).not.toBeNull();
		const certs = parsed!.certificatesAsn1.map((a) => forge.pki.certificateFromAsn1(a));
		vi.mocked(loadTrustStore).mockReturnValue(makeStore(forge.pki.createCaStore(certs), certs));

		const r = await verificarTimestampToken(tokenAsn1(), SIG_VALUE);
		expect(r).not.toBeNull();
		expect(r!.classe).toBe('icp');
	});
});
