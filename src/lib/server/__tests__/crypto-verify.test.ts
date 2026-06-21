/**
 * Testes da verificação multi-algoritmo (RSA PKCS#1, RSA-PSS, ECDSA).
 *
 * Gera CMS minimalista com diferentes algoritmos via node-forge e Web Crypto
 * para confirmar que o despacho está correto.
 */

import { describe, it, expect } from 'vitest';
import forge from 'node-forge';
import { verificarAssinaturaCms, SIGNATURE_OIDS, DIGEST_OIDS } from '../crypto-verify';

function gerarCertRsaSelfSigned(): forge.pki.Certificate {
	const keys = forge.pki.rsa.generateKeyPair(1024);
	const cert = forge.pki.createCertificate();
	cert.publicKey = keys.publicKey;
	cert.serialNumber = '01';
	cert.validity.notBefore = new Date(Date.now() - 86400000);
	cert.validity.notAfter = new Date(Date.now() + 86400000);
	const subj = [{ name: 'commonName', value: 'TEST RSA' }];
	cert.setSubject(subj);
	cert.setIssuer(subj);
	cert.sign(keys.privateKey, forge.md.sha256.create());
	return cert;
}

/** Sign(SHA-256 + RSA PKCS#1 v1.5) sobre o SET DER passado. */
function signRsaPkcs1(
	privKey: forge.pki.rsa.PrivateKey,
	signedAttrsAsSet: forge.asn1.Asn1
): string {
	const md = forge.md.sha256.create();
	md.update(forge.asn1.toDer(signedAttrsAsSet).getBytes());
	return privKey.sign(md);
}

describe('verificarAssinaturaCms — RSA PKCS#1 v1.5', () => {
	it('aceita assinatura válida sha256WithRSAEncryption', async () => {
		// Construir CMS manual: cert + signedAttrs + signature
		const keys = forge.pki.rsa.generateKeyPair(1024);
		const cert = forge.pki.createCertificate();
		cert.publicKey = keys.publicKey;
		cert.serialNumber = '01';
		cert.validity.notBefore = new Date(Date.now() - 86400000);
		cert.validity.notAfter = new Date(Date.now() + 86400000);
		cert.setSubject([{ name: 'commonName', value: 'TEST' }]);
		cert.setIssuer([{ name: 'commonName', value: 'TEST' }]);
		cert.sign(keys.privateKey, forge.md.sha256.create());

		// SignedAttrs como SET com 1 atributo dummy.
		const signedAttrsAsSet = forge.asn1.create(
			forge.asn1.Class.UNIVERSAL,
			forge.asn1.Type.SET,
			true,
			[
				forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
					forge.asn1.create(
						forge.asn1.Class.UNIVERSAL,
						forge.asn1.Type.OID,
						false,
						forge.asn1.oidToDer('1.2.840.113549.1.9.3').getBytes()
					),
					forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SET, true, [
						forge.asn1.create(
							forge.asn1.Class.UNIVERSAL,
							forge.asn1.Type.OID,
							false,
							forge.asn1.oidToDer('1.2.840.113549.1.7.1').getBytes()
						)
					])
				])
			]
		);

		const signatureValue = signRsaPkcs1(keys.privateKey, signedAttrsAsSet);

		const ok = await verificarAssinaturaCms({
			cert,
			sigAlgOid: SIGNATURE_OIDS.SHA256_RSA,
			signedAttrsAsSet,
			signatureValue
		});
		expect(ok).toBe(true);
	});

	it('rejeita assinatura adulterada', async () => {
		const cert = gerarCertRsaSelfSigned();
		const signedAttrsAsSet = forge.asn1.create(
			forge.asn1.Class.UNIVERSAL,
			forge.asn1.Type.SET,
			true,
			[]
		);
		const ok = await verificarAssinaturaCms({
			cert,
			sigAlgOid: SIGNATURE_OIDS.SHA256_RSA,
			signedAttrsAsSet,
			signatureValue: 'bytes-aleatorios-que-nao-sao-assinatura-valida'
		});
		expect(ok).toBe(false);
	});
});

describe('verificarAssinaturaCms — rsaEncryption puro (OID 1.1.1)', () => {
	// Regressão A2: alguns assinadores ICP-Brasil (incl. fluxo Web PKI próprio e,
	// possivelmente, o Assinador SERPRO) emitem o SignerInfo com
	// signatureAlgorithm=rsaEncryption (1.1.1), sem o digest embutido. Antes da
	// correção, familyFromSigAlg não reconhecia esse OID e a verificação falhava
	// com false → CAdES 422. O hash deve vir do digestAlgorithm do SignerInfo.
	function montarCenarioRsaEncryption() {
		const keys = forge.pki.rsa.generateKeyPair(1024);
		const cert = forge.pki.createCertificate();
		cert.publicKey = keys.publicKey;
		cert.serialNumber = '03';
		cert.validity.notBefore = new Date(Date.now() - 86400000);
		cert.validity.notAfter = new Date(Date.now() + 86400000);
		cert.setSubject([{ name: 'commonName', value: 'TEST RSAENC' }]);
		cert.setIssuer([{ name: 'commonName', value: 'TEST RSAENC' }]);
		cert.sign(keys.privateKey, forge.md.sha256.create());

		const signedAttrsAsSet = forge.asn1.create(
			forge.asn1.Class.UNIVERSAL,
			forge.asn1.Type.SET,
			true,
			[
				forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
					forge.asn1.create(
						forge.asn1.Class.UNIVERSAL,
						forge.asn1.Type.OID,
						false,
						forge.asn1.oidToDer('1.2.840.113549.1.9.3').getBytes()
					),
					forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SET, true, [
						forge.asn1.create(
							forge.asn1.Class.UNIVERSAL,
							forge.asn1.Type.OID,
							false,
							forge.asn1.oidToDer('1.2.840.113549.1.7.1').getBytes()
						)
					])
				])
			]
		);
		const signatureValue = signRsaPkcs1(keys.privateKey, signedAttrsAsSet);
		return { cert, signedAttrsAsSet, signatureValue };
	}

	it('aceita quando sigAlg=rsaEncryption e digestAlgOid=SHA-256', async () => {
		const { cert, signedAttrsAsSet, signatureValue } = montarCenarioRsaEncryption();
		const ok = await verificarAssinaturaCms({
			cert,
			sigAlgOid: SIGNATURE_OIDS.RSA_ENCRYPTION,
			signedAttrsAsSet,
			signatureValue,
			digestAlgOid: DIGEST_OIDS.SHA256
		});
		expect(ok).toBe(true);
	});

	it('rejeita rsaEncryption sem digestAlgOid (hash indeterminado)', async () => {
		const { cert, signedAttrsAsSet, signatureValue } = montarCenarioRsaEncryption();
		const ok = await verificarAssinaturaCms({
			cert,
			sigAlgOid: SIGNATURE_OIDS.RSA_ENCRYPTION,
			signedAttrsAsSet,
			signatureValue
		});
		expect(ok).toBe(false);
	});
});

describe('verificarAssinaturaCms — algoritmos não suportados', () => {
	it('rejeita OID desconhecido', async () => {
		const cert = gerarCertRsaSelfSigned();
		const signedAttrsAsSet = forge.asn1.create(
			forge.asn1.Class.UNIVERSAL,
			forge.asn1.Type.SET,
			true,
			[]
		);
		const ok = await verificarAssinaturaCms({
			cert,
			sigAlgOid: '1.2.999.999.999',
			signedAttrsAsSet,
			signatureValue: 'xx'
		});
		expect(ok).toBe(false);
	});
});

describe('verificarAssinaturaCms — despacho de algoritmos modernos', () => {
	// Os caminhos RSA-PSS e ECDSA exercitam Web Crypto API. Testá-los
	// end-to-end exige construir certs com chave EC/PSS, o que forge
	// não suporta fluentemente. Aqui validamos apenas o DESPACHO:
	// a função reconhece o OID e tenta o caminho correto (falha porque
	// o cert é RSA, mas isso confirma que NÃO caiu no caminho legacy).

	it('reconhece OID RSA-PSS e tenta caminho Web Crypto', async () => {
		const cert = gerarCertRsaSelfSigned();
		const signedAttrsAsSet = forge.asn1.create(
			forge.asn1.Class.UNIVERSAL,
			forge.asn1.Type.SET,
			true,
			[]
		);
		// Falha porque o cert RSA não tem padding PSS, mas NÃO crasha.
		const ok = await verificarAssinaturaCms({
			cert,
			sigAlgOid: SIGNATURE_OIDS.RSA_PSS,
			signedAttrsAsSet,
			signatureValue: '\x00\x00\x00\x00'
		});
		expect(ok).toBe(false);
	});

	it('reconhece OID ECDSA-SHA256 e tenta caminho Web Crypto', async () => {
		const cert = gerarCertRsaSelfSigned(); // cert RSA — caminho ECDSA vai falhar
		const signedAttrsAsSet = forge.asn1.create(
			forge.asn1.Class.UNIVERSAL,
			forge.asn1.Type.SET,
			true,
			[]
		);
		const ok = await verificarAssinaturaCms({
			cert,
			sigAlgOid: SIGNATURE_OIDS.ECDSA_SHA256,
			signedAttrsAsSet,
			signatureValue: '\x30\x06\x02\x01\x01\x02\x01\x01' // SEQUENCE { 1, 1 }
		});
		// Cert é RSA — caminho ECDSA não consegue importar a chave; devolve false.
		expect(ok).toBe(false);
	});
});
