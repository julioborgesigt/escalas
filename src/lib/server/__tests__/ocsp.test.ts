/**
 * Testes do cliente OCSP. Foca em cenários de erro e parser — geração de
 * certificado e fixtures via node-forge no próprio setup. Não exercita
 * roundtrip de rede real (consultarOcsp tem fetch mockado).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import forge from 'node-forge';
import { extrairUrlOcsp, statusDeSnapshot, consultarOcsp } from '../ocsp';

// ---------------------------------------------------------------------------
// Helpers — geram um certificado mínimo via node-forge para usar nos testes.
// ---------------------------------------------------------------------------

function gerarCertSelfSigned(opts?: { ocspUrl?: string }): {
	cert: forge.pki.Certificate;
	issuer: forge.pki.Certificate;
} {
	const keys = forge.pki.rsa.generateKeyPair(1024); // 1024 só para velocidade do teste
	const cert = forge.pki.createCertificate();
	cert.publicKey = keys.publicKey;
	cert.serialNumber = '01';
	cert.validity.notBefore = new Date(Date.now() - 24 * 3600 * 1000);
	cert.validity.notAfter = new Date(Date.now() + 24 * 3600 * 1000);
	const subj = [{ name: 'commonName', value: 'TESTE' }];
	cert.setSubject(subj);
	cert.setIssuer(subj);

	if (opts?.ocspUrl) {
		// node-forge não suporta AIA via nome amigável; construir DER manualmente.
		// AuthorityInfoAccessSyntax ::= SEQUENCE OF AccessDescription
		// AccessDescription ::= SEQUENCE { accessMethod OID, accessLocation [6] IA5String }
		const accessDesc = forge.asn1.create(
			forge.asn1.Class.UNIVERSAL,
			forge.asn1.Type.SEQUENCE,
			true,
			[
				forge.asn1.create(
					forge.asn1.Class.UNIVERSAL,
					forge.asn1.Type.OID,
					false,
					forge.asn1.oidToDer('1.3.6.1.5.5.7.48.1').getBytes()
				),
				forge.asn1.create(forge.asn1.Class.CONTEXT_SPECIFIC, 6, false, opts.ocspUrl)
			]
		);
		const aia = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
			accessDesc
		]);
		const aiaDer = forge.asn1.toDer(aia).getBytes();
		// Cast — a interface oficial tipa `value` como opcional, mas o code path
		// que preenche outros campos só roda quando há "name" reconhecido. AIA
		// não está no whitelist, então value é usado direto.
		cert.setExtensions([
			{ id: '1.3.6.1.5.5.7.1.1', critical: false, value: aiaDer } as unknown as Parameters<
				typeof cert.setExtensions
			>[0][number]
		]);
	}

	cert.sign(keys.privateKey, forge.md.sha256.create());
	return { cert, issuer: cert };
}

// ---------------------------------------------------------------------------
// extrairUrlOcsp
// ---------------------------------------------------------------------------

describe('extrairUrlOcsp', () => {
	it('extrai URL do AuthorityInfoAccess', () => {
		const { cert } = gerarCertSelfSigned({ ocspUrl: 'http://ocsp.example.com' });
		expect(extrairUrlOcsp(cert)).toBe('http://ocsp.example.com');
	});

	it('retorna null quando cert não tem extensão AIA', () => {
		const { cert } = gerarCertSelfSigned(); // sem ocspUrl
		expect(extrairUrlOcsp(cert)).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// statusDeSnapshot
// ---------------------------------------------------------------------------

describe('statusDeSnapshot', () => {
	it('retorna unknown para snapshot vazio', () => {
		expect(statusDeSnapshot('')).toEqual({ status: 'unknown' });
	});

	it('retorna unknown para base64 inválido', () => {
		expect(statusDeSnapshot('nao-é-base64-de-DER!!!').status).toBe('unknown');
	});

	it('retorna unknown para DER válido mas não-OCSP', () => {
		// Apenas um INTEGER mínimo (02 01 00) em base64
		expect(statusDeSnapshot('AgEA').status).toBe('unknown');
	});
});

// ---------------------------------------------------------------------------
// consultarOcsp — fetch mockado
// ---------------------------------------------------------------------------

describe('consultarOcsp', () => {
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		vi.useRealTimers();
	});

	it('retorna status unknown quando cert não tem URL OCSP', async () => {
		const { cert, issuer } = gerarCertSelfSigned(); // sem URL
		const snap = await consultarOcsp(cert, issuer);
		expect(snap.status).toBe('unknown');
		expect(snap.url).toBe('');
		expect(snap.erro).toMatch(/sem URL OCSP/i);
	});

	it('retorna unknown quando responder retorna 500', async () => {
		const { cert, issuer } = gerarCertSelfSigned({ ocspUrl: 'http://ocsp.example.com' });
		globalThis.fetch = vi
			.fn()
			.mockResolvedValue(new Response('boom', { status: 500 })) as unknown as typeof fetch;

		const snap = await consultarOcsp(cert, issuer);
		expect(snap.status).toBe('unknown');
		expect(snap.url).toBe('http://ocsp.example.com');
		expect(snap.erro).toMatch(/HTTP 500/);
	});

	it('retorna unknown quando fetch lança (rede offline / DNS)', async () => {
		const { cert, issuer } = gerarCertSelfSigned({ ocspUrl: 'http://ocsp.example.com' });
		globalThis.fetch = vi
			.fn()
			.mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof fetch;

		const snap = await consultarOcsp(cert, issuer);
		expect(snap.status).toBe('unknown');
		expect(snap.erro).toMatch(/ECONNREFUSED/);
	});

	it('sempre devolve consultadoEm ISO 8601', async () => {
		const { cert, issuer } = gerarCertSelfSigned();
		const snap = await consultarOcsp(cert, issuer);
		expect(snap.consultadoEm).toMatch(/^\d{4}-\d{2}-\d{2}T/);
	});

	it('responseDerB64 fica vazio em cenários de erro', async () => {
		const { cert, issuer } = gerarCertSelfSigned();
		const snap = await consultarOcsp(cert, issuer);
		expect(snap.responseDerB64).toBe('');
	});
});
