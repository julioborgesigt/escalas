/**
 * Regressão: `parseCms` escolhe o certificado do SIGNATÁRIO pelo
 * `SignerInfo.sid`, não pela posição no `SET OF Certificate`.
 *
 * Em DER, a ordem de um `SET OF` é definida pela ordenação byte a byte da
 * codificação de cada elemento — não pelo papel de cada certificado. Assumir
 * `certificates[0]` funcionava por sorte: quando a folha não ordenava primeiro,
 * a verificação usava a chave pública errada e um documento legítimo reprovava
 * no `/validar`.
 *
 * Os testes montam um CMS com DOIS certificados e reordenam o SET à mão, para
 * que o signatário fique em segundo — a situação que a suposição antiga
 * quebrava.
 */
import { describe, it, expect } from 'vitest';
import forge from 'node-forge';
import { parseCms, verificarAssinaturaCmsAsync } from '../pdf-verification';
import { binStringToBytes } from '$lib/crypto/bin';

const PAR_SIGNATARIO = forge.pki.rsa.generateKeyPair(2048);
const PAR_ESTRANHO = forge.pki.rsa.generateKeyPair(2048);

function criarCert(
	par: forge.pki.rsa.KeyPair,
	commonName: string,
	serialNumber: string
): forge.pki.Certificate {
	const cert = forge.pki.createCertificate();
	cert.publicKey = par.publicKey;
	cert.serialNumber = serialNumber;
	cert.validity.notBefore = new Date(Date.now() - 86400000);
	cert.validity.notAfter = new Date(Date.now() + 86400000);
	const subj = [{ name: 'commonName', value: commonName }];
	cert.setSubject(subj);
	cert.setIssuer(subj);
	cert.setExtensions([{ name: 'keyUsage', digitalSignature: true, nonRepudiation: true }]);
	cert.sign(par.privateKey, forge.md.sha256.create());
	return cert;
}

const CERT_SIGNATARIO = criarCert(PAR_SIGNATARIO, 'QUEM ASSINOU', '0B');
const CERT_ESTRANHO = criarCert(PAR_ESTRANHO, 'OUTRO CERTIFICADO', '0C');

/**
 * CMS detached com os dois certificados. `signatarioPrimeiro = false` reordena o
 * SET para que a folha do signatário venha DEPOIS do certificado estranho.
 */
function gerarCms(conteudo: string, signatarioPrimeiro: boolean): Uint8Array {
	const p7 = forge.pkcs7.createSignedData();
	p7.content = forge.util.createBuffer(conteudo);
	p7.addCertificate(CERT_SIGNATARIO);
	p7.addCertificate(CERT_ESTRANHO);
	p7.addSigner({
		key: PAR_SIGNATARIO.privateKey,
		certificate: CERT_SIGNATARIO,
		digestAlgorithm: forge.pki.oids.sha256,
		authenticatedAttributes: [
			{ type: forge.pki.oids.contentType, value: forge.pki.oids.data },
			{ type: forge.pki.oids.messageDigest }
		]
	});
	p7.sign({ detached: true });

	const asn1 = p7.toAsn1();
	// ContentInfo → [0] EXPLICIT → SignedData → [0] IMPLICIT certificates
	const signedData = ((asn1.value as forge.asn1.Asn1[])[1].value as forge.asn1.Asn1[])[0];
	const certsImpl = (signedData.value as forge.asn1.Asn1[]).find(
		(f) => f.tagClass === forge.asn1.Class.CONTEXT_SPECIFIC && (f.type as number) === 0
	);
	const certs = certsImpl!.value as forge.asn1.Asn1[];
	// forge insere na ordem em que `addCertificate` foi chamado; forçamos a que
	// o teste precisa em vez de depender desse detalhe.
	const derSignatario = forge.asn1.toDer(forge.pki.certificateToAsn1(CERT_SIGNATARIO)).getBytes();
	certs.sort((a, b) => {
		const aEhSignatario = forge.asn1.toDer(a).getBytes() === derSignatario;
		if (aEhSignatario === (forge.asn1.toDer(b).getBytes() === derSignatario)) return 0;
		const primeiroFicaAntes = aEhSignatario === signatarioPrimeiro;
		return primeiroFicaAntes ? -1 : 1;
	});

	return binStringToBytes(forge.asn1.toDer(asn1).getBytes());
}

describe('parseCms — resolução do certificado do signatário', () => {
	it('acha a folha pelo sid mesmo quando ela NÃO é a primeira do SET', () => {
		const cms = parseCms(gerarCms('conteudo qualquer', false));
		expect(cms).not.toBeNull();
		expect(cms!.certificate.subject.getField('CN').value).toBe('QUEM ASSINOU');
		// O SET realmente tem o estranho na frente — senão o teste não prova nada.
		expect(
			forge.pki.certificateFromAsn1(cms!.certificatesAsn1[0]).subject.getField('CN').value
		).toBe('OUTRO CERTIFICADO');
	});

	it('acha a mesma folha quando ela é a primeira do SET', () => {
		const cms = parseCms(gerarCms('conteudo qualquer', true));
		expect(cms).not.toBeNull();
		expect(cms!.certificate.subject.getField('CN').value).toBe('QUEM ASSINOU');
	});

	it('a assinatura confere com o certificado resolvido, na ordem desfavorável', async () => {
		// O ponto prático: com `certificates[0]` a verificação usava a chave do
		// certificado estranho e devolvia `false` para uma assinatura legítima.
		const cms = parseCms(gerarCms('conteudo qualquer', false));
		const ok = await verificarAssinaturaCmsAsync(
			cms!.certificate,
			cms!.sigAlgOid,
			cms!.signedAttrsAsSet,
			cms!.signatureValue,
			cms!.digestAlgOid
		);
		expect(ok).toBe(true);
	});

	it('expõe todos os certificados embutidos, para os callers que varrem a cadeia', () => {
		const cms = parseCms(gerarCms('conteudo qualquer', false));
		expect(cms!.certificatesAsn1).toHaveLength(2);
	});

	it('resolve pelo subjectKeyIdentifier quando o sid usa essa variante', () => {
		// O `SignerIdentifier` é um CHOICE: `issuerAndSerialNumber` (SEQUENCE) ou
		// `subjectKeyIdentifier` ([0] IMPLICIT OCTET STRING). O node-forge só emite
		// a primeira, então a segunda é montada à mão aqui — sem isto o ramo SKI
		// ficaria sem teste nenhum, que é onde bug defensivo se esconde.
		const cms = parseCms(gerarCmsComSidPorSki());
		expect(cms).not.toBeNull();
		expect(cms!.certificate.subject.getField('CN').value).toBe('QUEM ASSINOU');
	});

	it('cai no primeiro do SET quando o sid não casa com nenhum certificado', () => {
		// Compatibilidade: um CMS cujo sid aponte para um certificado ausente não
		// pode virar `parseCms` nulo — antes desta mudança ele parseava normalmente
		// (usando o primeiro do SET), e a verificação de assinatura é que decidia.
		const cms = parseCms(gerarCmsComSidInexistente());
		expect(cms).not.toBeNull();
		expect(cms!.certificate.subject.getField('CN').value).toBe(
			forge.pki.certificateFromAsn1(cms!.certificatesAsn1[0]).subject.getField('CN').value
		);
	});
});

/** Navega até o SignerInfo e troca o `sid` (filho 1) pelo nó dado. */
function trocarSid(asn1: forge.asn1.Asn1, novoSid: forge.asn1.Asn1): Uint8Array {
	const signedData = ((asn1.value as forge.asn1.Asn1[])[1].value as forge.asn1.Asn1[])[0];
	const signerInfos = (signedData.value as forge.asn1.Asn1[]).find(
		(f) => f.tagClass === forge.asn1.Class.UNIVERSAL && f.type === forge.asn1.Type.SET
	)!;
	const si = (signerInfos.value as forge.asn1.Asn1[])[0].value as forge.asn1.Asn1[];
	si[1] = novoSid;
	return binStringToBytes(forge.asn1.toDer(asn1).getBytes());
}

/** CMS cujo `sid` é o SKI do signatário, com ele em SEGUNDO no SET. */
function gerarCmsComSidPorSki(): Uint8Array {
	const certComSki = forge.pki.createCertificate();
	certComSki.publicKey = PAR_SIGNATARIO.publicKey;
	certComSki.serialNumber = '0D';
	certComSki.validity.notBefore = new Date(Date.now() - 86400000);
	certComSki.validity.notAfter = new Date(Date.now() + 86400000);
	const subj = [{ name: 'commonName', value: 'QUEM ASSINOU' }];
	certComSki.setSubject(subj);
	certComSki.setIssuer(subj);
	certComSki.setExtensions([
		{ name: 'keyUsage', digitalSignature: true, nonRepudiation: true },
		{ name: 'subjectKeyIdentifier' }
	]);
	certComSki.sign(PAR_SIGNATARIO.privateKey, forge.md.sha256.create());

	const p7 = forge.pkcs7.createSignedData();
	p7.content = forge.util.createBuffer('conteudo qualquer');
	// Estranho PRIMEIRO: se a resolução voltasse a olhar a posição, pegaria ele.
	p7.addCertificate(CERT_ESTRANHO);
	p7.addCertificate(certComSki);
	p7.addSigner({
		key: PAR_SIGNATARIO.privateKey,
		certificate: certComSki,
		digestAlgorithm: forge.pki.oids.sha256,
		authenticatedAttributes: [
			{ type: forge.pki.oids.contentType, value: forge.pki.oids.data },
			{ type: forge.pki.oids.messageDigest }
		]
	});
	p7.sign({ detached: true });

	const skiHex = (
		certComSki.getExtension('subjectKeyIdentifier') as { subjectKeyIdentifier: string }
	).subjectKeyIdentifier;
	const sidSki = forge.asn1.create(
		forge.asn1.Class.CONTEXT_SPECIFIC,
		0,
		false,
		forge.util.hexToBytes(skiHex)
	);
	return trocarSid(p7.toAsn1(), sidSki);
}

/** CMS cujo `sid` aponta para um issuer/serial que não está no SET. */
function gerarCmsComSidInexistente(): Uint8Array {
	const p7 = forge.pkcs7.createSignedData();
	p7.content = forge.util.createBuffer('conteudo qualquer');
	p7.addCertificate(CERT_SIGNATARIO);
	p7.addSigner({
		key: PAR_SIGNATARIO.privateKey,
		certificate: CERT_SIGNATARIO,
		digestAlgorithm: forge.pki.oids.sha256,
		authenticatedAttributes: [
			{ type: forge.pki.oids.contentType, value: forge.pki.oids.data },
			{ type: forge.pki.oids.messageDigest }
		]
	});
	p7.sign({ detached: true });

	// Issuer REAL (o do próprio signatário) com número de série que não existe:
	// o sid fica bem-formado e mesmo assim não casa com nada no SET.
	const tbs = (forge.pki.certificateToAsn1(CERT_SIGNATARIO).value as forge.asn1.Asn1[])[0]
		.value as forge.asn1.Asn1[];
	const issuerAsn1 = tbs[tbs[0].tagClass === forge.asn1.Class.CONTEXT_SPECIFIC ? 3 : 2];
	const sidFantasma = forge.asn1.create(
		forge.asn1.Class.UNIVERSAL,
		forge.asn1.Type.SEQUENCE,
		true,
		[
			issuerAsn1,
			forge.asn1.create(
				forge.asn1.Class.UNIVERSAL,
				forge.asn1.Type.INTEGER,
				false,
				forge.util.hexToBytes('7F')
			)
		]
	);
	return trocarSid(p7.toAsn1(), sidFantasma);
}
