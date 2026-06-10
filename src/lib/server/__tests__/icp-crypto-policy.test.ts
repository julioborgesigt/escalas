/**
 * Política criptográfica mínima do signatário (`avaliarPoliticaCriptografica`):
 * SHA-1 rejeitado, RSA < 2048 rejeitado, keyUsage de assinatura obrigatório.
 * Sem isso, uma assinatura forjável (SHA-1/RSA-1024) ou um certificado ICP
 * emitido só para autenticação passariam por assinatura qualificada.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import forge from 'node-forge';
import { avaliarPoliticaCriptografica } from '../pdf-verification';
import { SIGNATURE_OIDS, DIGEST_OIDS } from '../crypto-verify';

function gerarCert(
	bits: number,
	keyUsage: Record<string, boolean> | null
): forge.pki.Certificate {
	const keys = forge.pki.rsa.generateKeyPair(bits);
	const cert = forge.pki.createCertificate();
	cert.publicKey = keys.publicKey;
	cert.serialNumber = '01';
	cert.validity.notBefore = new Date(Date.now() - 86400000);
	cert.validity.notAfter = new Date(Date.now() + 86400000);
	const subj = [{ name: 'commonName', value: 'TESTE POLITICA:12345678901' }];
	cert.setSubject(subj);
	cert.setIssuer(subj);
	if (keyUsage) cert.setExtensions([{ name: 'keyUsage', ...keyUsage }]);
	cert.sign(keys.privateKey, forge.md.sha256.create());
	return cert;
}

let cert2048: forge.pki.Certificate;
let cert1024: forge.pki.Certificate;

beforeAll(() => {
	cert2048 = gerarCert(2048, { digitalSignature: true, nonRepudiation: true });
	cert1024 = gerarCert(1024, { digitalSignature: true, nonRepudiation: true });
});

describe('avaliarPoliticaCriptografica', () => {
	it('aceita SHA-256 + RSA-2048 + keyUsage de assinatura', () => {
		const r = avaliarPoliticaCriptografica(SIGNATURE_OIDS.SHA256_RSA, undefined, cert2048);
		expect(r.ok, r.motivo).toBe(true);
	});

	it('aceita rsaEncryption puro com digest SHA-256', () => {
		const r = avaliarPoliticaCriptografica(
			SIGNATURE_OIDS.RSA_ENCRYPTION,
			DIGEST_OIDS.SHA256,
			cert2048
		);
		expect(r.ok, r.motivo).toBe(true);
	});

	it('rejeita sha1WithRSAEncryption', () => {
		const r = avaliarPoliticaCriptografica(SIGNATURE_OIDS.SHA1_RSA, undefined, cert2048);
		expect(r.ok).toBe(false);
		expect(r.motivo).toMatch(/SHA-1/);
	});

	it('rejeita rsaEncryption puro com digest SHA-1', () => {
		const r = avaliarPoliticaCriptografica(
			SIGNATURE_OIDS.RSA_ENCRYPTION,
			DIGEST_OIDS.SHA1,
			cert2048
		);
		expect(r.ok).toBe(false);
		expect(r.motivo).toMatch(/SHA-1/);
	});

	it('rejeita RSA < 2048 bits', () => {
		const r = avaliarPoliticaCriptografica(SIGNATURE_OIDS.SHA256_RSA, undefined, cert1024);
		expect(r.ok).toBe(false);
		expect(r.motivo).toMatch(/1024 bits/);
	});

	it('rejeita certificado sem extensão keyUsage', () => {
		const cert = gerarCert(2048, null);
		const r = avaliarPoliticaCriptografica(SIGNATURE_OIDS.SHA256_RSA, undefined, cert);
		expect(r.ok).toBe(false);
		expect(r.motivo).toMatch(/keyUsage/);
	});

	it('rejeita keyUsage sem digitalSignature/nonRepudiation', () => {
		const cert = gerarCert(2048, { keyEncipherment: true });
		const r = avaliarPoliticaCriptografica(SIGNATURE_OIDS.SHA256_RSA, undefined, cert);
		expect(r.ok).toBe(false);
		expect(r.motivo).toMatch(/keyUsage/);
	});
});
