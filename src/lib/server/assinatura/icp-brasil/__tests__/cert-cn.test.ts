/**
 * Lookup de CN no trust store — o find copiado em três módulos.
 */
import { describe, it, expect } from 'vitest';
import forge from 'node-forge';
import { cnDoCertificado, encontrarCertPorCN, encontrarIssuerNoTrustStore } from '../cert-cn';

function certComCNs(subject: string, issuer: string): forge.pki.Certificate {
	return {
		subject: { getField: (n: string) => (n === 'CN' ? { value: subject } : null) },
		issuer: { getField: (n: string) => (n === 'CN' ? { value: issuer } : null) }
	} as unknown as forge.pki.Certificate;
}

describe('cnDoCertificado', () => {
	it('lê subject por padrão e issuer quando pedido', () => {
		const c = certComCNs('TITULAR', 'AC INTERMEDIARIA');
		expect(cnDoCertificado(c)).toBe('TITULAR');
		expect(cnDoCertificado(c, 'issuer')).toBe('AC INTERMEDIARIA');
	});

	it('string vazia quando o campo não existe', () => {
		const c = {
			subject: { getField: () => null },
			issuer: { getField: () => null }
		} as unknown as forge.pki.Certificate;
		expect(cnDoCertificado(c)).toBe('');
	});
});

describe('encontrarCertPorCN', () => {
	const a = certComCNs('AC EXEMPLO', 'AC RAIZ');
	const b = certComCNs('AC OUTRA', 'AC RAIZ');

	it('devolve o certificado cujo subject CN coincide', () => {
		expect(encontrarCertPorCN([a, b], 'AC OUTRA')).toBe(b);
	});

	it('undefined quando ninguém bate', () => {
		expect(encontrarCertPorCN([a, b], 'INEXISTENTE')).toBeUndefined();
	});
});

describe('encontrarIssuerNoTrustStore', () => {
	const intermediaria = certComCNs('AC INTERMEDIARIA', 'AC RAIZ');
	const raiz = certComCNs('AC RAIZ', 'AC RAIZ');
	const titular = certComCNs('FULANO', 'AC INTERMEDIARIA');

	it('acha o issuer nos intermediários', () => {
		expect(
			encontrarIssuerNoTrustStore(titular, { intermediates: [intermediaria], roots: [raiz] })
		).toBe(intermediaria);
	});

	it('acha o issuer nas raízes quando o CN está lá', () => {
		const autoassinado = certComCNs('AC RAIZ', 'AC RAIZ');
		expect(encontrarIssuerNoTrustStore(autoassinado, { intermediates: [], roots: [raiz] })).toBe(
			raiz
		);
	});

	it('undefined quando o CN do issuer não está no store', () => {
		expect(
			encontrarIssuerNoTrustStore(titular, { intermediates: [], roots: [raiz] })
		).toBeUndefined();
	});
});
