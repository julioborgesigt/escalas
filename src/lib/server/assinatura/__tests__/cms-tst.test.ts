/**
 * Testes do mutador CMS → CAdES-T (adiciona TimeStampToken como
 * UnsignedAttribute do SignerInfo).
 *
 * Gera CMS minimalista via node-forge no setup para evitar dependência
 * de fixtures binários.
 */

import { describe, it, expect } from 'vitest';
import forge from 'node-forge';
import { adicionarTimestampTokenAoCms } from '../cms-tst';

const OID_TIME_STAMP_TOKEN = '1.2.840.113549.1.9.16.2.14';

function gerarCmsMinimo(): Uint8Array {
	const keys = forge.pki.rsa.generateKeyPair(1024);
	const cert = forge.pki.createCertificate();
	cert.publicKey = keys.publicKey;
	cert.serialNumber = '01';
	cert.validity.notBefore = new Date(Date.now() - 86400000);
	cert.validity.notAfter = new Date(Date.now() + 86400000);
	const subj = [{ name: 'commonName', value: 'TESTE' }];
	cert.setSubject(subj);
	cert.setIssuer(subj);
	cert.sign(keys.privateKey, forge.md.sha256.create());

	const p7 = forge.pkcs7.createSignedData();
	p7.content = forge.util.createBuffer('payload');
	p7.addCertificate(cert);
	p7.addSigner({
		key: keys.privateKey,
		certificate: cert,
		digestAlgorithm: forge.pki.oids.sha256,
		authenticatedAttributes: [
			{ type: forge.pki.oids.contentType, value: forge.pki.oids.data },
			{ type: forge.pki.oids.messageDigest },
			{ type: forge.pki.oids.signingTime, value: new Date() as unknown as string }
		]
	});
	p7.sign({ detached: true });

	const der = forge.asn1.toDer(p7.toAsn1()).getBytes();
	const out = new Uint8Array(der.length);
	for (let i = 0; i < der.length; i++) out[i] = der.charCodeAt(i) & 0xff;
	return out;
}

/** Constrói um TimeStampToken dummy (apenas a estrutura ContentInfo). */
function gerarTstDummy(): forge.asn1.Asn1 {
	return forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
		forge.asn1.create(
			forge.asn1.Class.UNIVERSAL,
			forge.asn1.Type.OID,
			false,
			forge.asn1.oidToDer('1.2.840.113549.1.7.2').getBytes()
		),
		forge.asn1.create(forge.asn1.Class.CONTEXT_SPECIFIC, 0, true, [
			forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [])
		])
	]);
}

function findSignerInfo(cmsDer: Uint8Array): forge.asn1.Asn1 {
	let bin = '';
	for (const b of cmsDer) bin += String.fromCharCode(b);
	const cms = forge.asn1.fromDer(forge.util.createBuffer(bin));
	const wrap = (cms.value as forge.asn1.Asn1[])[1];
	const sd = (wrap.value as forge.asn1.Asn1[])[0];
	// SignedData tem 2 SETs universais (digestAlgorithms e signerInfos) —
	// pegamos o ÚLTIMO via sobrescrita no loop.
	let signerInfos: forge.asn1.Asn1 | null = null;
	for (const f of sd.value as forge.asn1.Asn1[]) {
		if (f.tagClass === forge.asn1.Class.UNIVERSAL && (f.type as number) === forge.asn1.Type.SET) {
			signerInfos = f;
		}
	}
	if (!signerInfos) throw new Error('signerInfos não encontrado');
	return (signerInfos.value as forge.asn1.Asn1[])[0];
}

describe('adicionarTimestampTokenAoCms', () => {
	it('insere unsignedAttrs [1] IMPLICIT no SignerInfo', () => {
		const cmsOriginal = gerarCmsMinimo();
		const tst = gerarTstDummy();

		const cmsNovo = adicionarTimestampTokenAoCms(cmsOriginal, tst);
		expect(cmsNovo.length).toBeGreaterThan(cmsOriginal.length);

		// Verifica que o SignerInfo ganhou o campo [1].
		const si = findSignerInfo(cmsNovo);
		const unsigned = (si.value as forge.asn1.Asn1[]).find(
			(f) => f.tagClass === forge.asn1.Class.CONTEXT_SPECIFIC && (f.type as number) === 1
		);
		expect(unsigned).toBeDefined();
	});

	it('o atributo inserido tem OID id-aa-timeStampToken', () => {
		const cmsOriginal = gerarCmsMinimo();
		const tst = gerarTstDummy();

		const cmsNovo = adicionarTimestampTokenAoCms(cmsOriginal, tst);
		const si = findSignerInfo(cmsNovo);
		const unsigned = (si.value as forge.asn1.Asn1[]).find(
			(f) => f.tagClass === forge.asn1.Class.CONTEXT_SPECIFIC && (f.type as number) === 1
		)!;
		const attr = (unsigned.value as forge.asn1.Asn1[])[0];
		const oidBytes = (attr.value as forge.asn1.Asn1[])[0].value as string;
		expect(forge.asn1.derToOid(oidBytes)).toBe(OID_TIME_STAMP_TOKEN);
	});

	it('NÃO altera signedAttrs nem signatureValue (preserva validade RSA)', () => {
		const cmsOriginal = gerarCmsMinimo();
		const tst = gerarTstDummy();

		const siOriginal = findSignerInfo(cmsOriginal);
		const signedAttrsOriginal = (siOriginal.value as forge.asn1.Asn1[]).find(
			(f) => f.tagClass === forge.asn1.Class.CONTEXT_SPECIFIC && (f.type as number) === 0
		);
		const sigOriginal = (siOriginal.value as forge.asn1.Asn1[]).find(
			(f) =>
				f.tagClass === forge.asn1.Class.UNIVERSAL &&
				(f.type as number) === forge.asn1.Type.OCTETSTRING
		);

		const cmsNovo = adicionarTimestampTokenAoCms(cmsOriginal, tst);
		const siNovo = findSignerInfo(cmsNovo);
		const signedAttrsNovo = (siNovo.value as forge.asn1.Asn1[]).find(
			(f) => f.tagClass === forge.asn1.Class.CONTEXT_SPECIFIC && (f.type as number) === 0
		);
		const sigNovo = (siNovo.value as forge.asn1.Asn1[]).find(
			(f) =>
				f.tagClass === forge.asn1.Class.UNIVERSAL &&
				(f.type as number) === forge.asn1.Type.OCTETSTRING
		);

		// Re-serializa cada componente e compara byte a byte.
		expect(forge.asn1.toDer(signedAttrsNovo!).getBytes()).toBe(
			forge.asn1.toDer(signedAttrsOriginal!).getBytes()
		);
		expect(forge.asn1.toDer(sigNovo!).getBytes()).toBe(forge.asn1.toDer(sigOriginal!).getBytes());
	});
});
