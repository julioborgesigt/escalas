/**
 * Testes da política de revogação (OCSP) no login por certificado — achado M-1
 * da auditoria de segurança 2026-07-10.
 *
 * Cobrimos a função pura `avaliarSnapshotOcspLogin` (mapeia snapshot → decisão)
 * e a orquestração `verificarRevogacaoParaLogin` com `consultar`/`trustStore`
 * injetados (sem rede nem trust store real). A regra espelha o cades-finalizer:
 *   - 'revoked'                 → nega (fail-closed);
 *   - assinatura do responder inválida → nega (indistinguível de MITM);
 *   - 'good'                    → permite;
 *   - 'unknown' / issuer ausente → permite (soft-fail auditável).
 */
import { describe, it, expect, vi } from 'vitest';
import forge from 'node-forge';
import {
	avaliarSnapshotOcspLogin,
	verificarRevogacaoParaLogin
} from '../cert-login';
import type { OcspSnapshot } from '../ocsp';

function snapshot(parcial: Partial<OcspSnapshot>): OcspSnapshot {
	return {
		status: 'unknown',
		responseDerB64: '',
		url: 'http://ocsp.exemplo.gov.br',
		consultadoEm: new Date().toISOString(),
		...parcial
	};
}

/** Certificado mínimo com um dado issuer CN (só o que a função lê). */
function certComIssuerCN(cn: string): forge.pki.Certificate {
	const keys = forge.pki.rsa.generateKeyPair(512);
	const cert = forge.pki.createCertificate();
	cert.publicKey = keys.publicKey;
	cert.serialNumber = '01';
	cert.validity.notBefore = new Date(Date.now() - 1000);
	cert.validity.notAfter = new Date(Date.now() + 1000);
	cert.setSubject([{ name: 'commonName', value: 'FULANO' }]);
	cert.setIssuer([{ name: 'commonName', value: cn }]);
	cert.sign(keys.privateKey);
	return cert;
}

function issuerComSubjectCN(cn: string): forge.pki.Certificate {
	const keys = forge.pki.rsa.generateKeyPair(512);
	const cert = forge.pki.createCertificate();
	cert.publicKey = keys.publicKey;
	cert.serialNumber = '02';
	cert.validity.notBefore = new Date(Date.now() - 1000);
	cert.validity.notAfter = new Date(Date.now() + 1000);
	cert.setSubject([{ name: 'commonName', value: cn }]);
	cert.setIssuer([{ name: 'commonName', value: cn }]);
	cert.sign(keys.privateKey);
	return cert;
}

describe('avaliarSnapshotOcspLogin', () => {
	it("nega quando status é 'revoked'", () => {
		const d = avaliarSnapshotOcspLogin(snapshot({ status: 'revoked', revokedAt: '2026-01-01' }));
		expect(d.permitido).toBe(false);
		if (!d.permitido) {
			expect(d.motivo).toBe('revogado');
			expect(d.revokedAt).toBe('2026-01-01');
		}
	});

	it('nega quando a assinatura do responder é inválida (possível MITM)', () => {
		// Mesmo com status good, assinatura inválida torna o snapshot inutilizável.
		const d = avaliarSnapshotOcspLogin(
			snapshot({ status: 'good', assinaturaResponder: 'invalida' })
		);
		expect(d.permitido).toBe(false);
		if (!d.permitido) expect(d.motivo).toBe('resposta_nao_confiavel');
	});

	it("permite quando status é 'good'", () => {
		const d = avaliarSnapshotOcspLogin(
			snapshot({ status: 'good', assinaturaResponder: 'valida' })
		);
		expect(d.permitido).toBe(true);
		if (d.permitido) expect(d.ocsp).toBe('good');
	});

	it("permite (soft-fail) quando status é 'unknown' (responder indisponível)", () => {
		const d = avaliarSnapshotOcspLogin(snapshot({ status: 'unknown', erro: 'timeout' }));
		expect(d.permitido).toBe(true);
		if (d.permitido) {
			expect(d.ocsp).toBe('unknown');
			expect(d.aviso).toBe('timeout');
		}
	});
});

describe('verificarRevogacaoParaLogin', () => {
	const trustStore = { intermediates: [issuerComSubjectCN('AC EXEMPLO')], roots: [] };

	it('propaga a negação de um certificado revogado', async () => {
		const consultar = vi.fn().mockResolvedValue(snapshot({ status: 'revoked' }));
		const d = await verificarRevogacaoParaLogin(certComIssuerCN('AC EXEMPLO'), {
			consultar,
			trustStore
		});
		expect(consultar).toHaveBeenCalledOnce();
		expect(d.permitido).toBe(false);
	});

	it("soft-fail 'unknown' quando o issuer não está no trust store (sem consultar)", async () => {
		const consultar = vi.fn();
		const d = await verificarRevogacaoParaLogin(certComIssuerCN('AC DESCONHECIDA'), {
			consultar,
			trustStore
		});
		expect(consultar).not.toHaveBeenCalled();
		expect(d.permitido).toBe(true);
		if (d.permitido) expect(d.ocsp).toBe('unknown');
	});

	it("soft-fail 'unknown' quando a consulta lança (nunca deve derrubar o login)", async () => {
		const consultar = vi.fn().mockRejectedValue(new Error('boom'));
		const d = await verificarRevogacaoParaLogin(certComIssuerCN('AC EXEMPLO'), {
			consultar,
			trustStore
		});
		expect(d.permitido).toBe(true);
		if (d.permitido) expect(d.ocsp).toBe('unknown');
	});

	it("permite 'good' com issuer localizado no trust store", async () => {
		const consultar = vi
			.fn()
			.mockResolvedValue(snapshot({ status: 'good', assinaturaResponder: 'valida' }));
		const d = await verificarRevogacaoParaLogin(certComIssuerCN('AC EXEMPLO'), {
			consultar,
			trustStore
		});
		expect(d.permitido).toBe(true);
		if (d.permitido) expect(d.ocsp).toBe('good');
	});
});
