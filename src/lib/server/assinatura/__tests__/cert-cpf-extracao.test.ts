/**
 * O CPF do signatário ICP-Brasil sai do atributo `serialNumber` do subject
 * (OID 2.5.4.5) e, só como fallback, do CN no formato "NOME:CPF".
 *
 * A armadilha: `cert.subject.getField('serialNumber')` devolve SEMPRE `null` no
 * node-forge — a busca por string é feita pelo `shortName`, e o atributo
 * 2.5.4.5 não tem shortName na tabela OID da biblioteca. `extrairDadosDoCertificado`
 * usa `{ type: '2.5.4.5' }`, mas havia duas cópias da lógica (na finalização
 * CAdES e na verificação de PDF) escritas com a forma quebrada, que exibiam CPF
 * vazio para e-CPF cujo CN não embute ":CPF".
 *
 * Estes testes fixam o comportamento correto no ponto único de extração.
 */
import { describe, it, expect } from 'vitest';
import forge from 'node-forge';
import { extrairDadosDoCertificado } from '../pdf-signing-prepare';

function certificadoComSubject(attrs: { name?: string; type?: string; value: string }[]) {
	const keys = forge.pki.rsa.generateKeyPair(1024);
	const cert = forge.pki.createCertificate();
	cert.publicKey = keys.publicKey;
	cert.serialNumber = '03';
	cert.validity.notBefore = new Date(Date.now() - 86_400_000);
	cert.validity.notAfter = new Date(Date.now() + 86_400_000);
	cert.setSubject(attrs);
	cert.setIssuer(attrs);
	cert.sign(keys.privateKey, forge.md.sha256.create());
	// Round-trip DER: reproduz o certificado como ele chega do CMS assinado.
	const der = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
	return forge.pki.certificateFromAsn1(forge.asn1.fromDer(der));
}

describe('extrairDadosDoCertificado', () => {
	it('lê o CPF do atributo serialNumber quando o CN não o embute', () => {
		const cert = certificadoComSubject([
			{ name: 'commonName', value: 'FULANO DE TAL' },
			{ type: '2.5.4.5', value: '12345678901' }
		]);

		// Regressão do bug: a forma quebrada não enxerga o atributo.
		expect(cert.subject.getField('serialNumber')).toBeNull();

		expect(extrairDadosDoCertificado(cert)).toEqual({
			nome: 'FULANO DE TAL',
			cpf: '12345678901'
		});
	});

	it('usa o CN como fallback no formato "NOME:CPF"', () => {
		const cert = certificadoComSubject([
			{ name: 'commonName', value: 'BELTRANA DE SOUZA:98765432100' }
		]);
		expect(extrairDadosDoCertificado(cert)).toEqual({
			nome: 'BELTRANA DE SOUZA',
			cpf: '98765432100'
		});
	});

	it('mantém os 11 últimos dígitos quando o serialNumber traz outros dados', () => {
		const cert = certificadoComSubject([
			{ name: 'commonName', value: 'CICRANO' },
			{ type: '2.5.4.5', value: '000000000012345678901' }
		]);
		expect(extrairDadosDoCertificado(cert).cpf).toBe('12345678901');
	});

	it('devolve CPF vazio quando o certificado não traz nenhum', () => {
		const cert = certificadoComSubject([{ name: 'commonName', value: 'SEM CPF' }]);
		expect(extrairDadosDoCertificado(cert)).toEqual({ nome: 'SEM CPF', cpf: '' });
	});
});
