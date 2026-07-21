/**
 * Assinador CMS de TESTE — faz o papel do Assinador SERPRO Desktop no runner.
 *
 * O contrato real (vide src/lib/assinatura-token.ts + PainelAssinaturaToken):
 * o cliente recebe do `preparar-assinatura` o PDF com placeholder e o
 * `messageDigest` (SHA-256 hex do ByteRange), manda o digest ao SERPRO e
 * recebe de volta um CMS SignedData COMPLETO (campo `serproCms` do finalizar).
 *
 * Aqui reproduzimos isso com node-forge (a MESMA biblioteca que o servidor usa
 * para parsear/verificar): CMS destacado sobre os bytes do ByteRange, com
 * authenticatedAttributes (contentType, messageDigest, signingTime) assinados
 * em RSA/SHA-256 pela chave do certificado de teste.
 */
import forge from 'node-forge';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DIR = join(dirname(fileURLToPath(import.meta.url)), 'artefatos');

export function carregarCertTeste(base: 'leaf' | 'outro-cpf' | 'supervisor' | 'rogue'): {
	cert: forge.pki.Certificate;
	key: forge.pki.PrivateKey;
} {
	const cert = forge.pki.certificateFromPem(readFileSync(join(DIR, `${base}.pem`), 'utf8'));
	const key = forge.pki.privateKeyFromPem(readFileSync(join(DIR, `${base}.key.pem`), 'utf8'));
	return { cert, key };
}

/**
 * Extrai os bytes ASSINADOS (regiões do ByteRange) do PDF preparado — o mesmo
 * recorte que o servidor verifica contra o messageDigest do CMS.
 */
export function bytesDoByteRange(preparedPdf: Buffer): Buffer {
	const pdfStr = preparedPdf.toString('latin1');
	// O placeholder recém-criado é a ÚLTIMA assinatura do arquivo.
	const matches = [...pdfStr.matchAll(/\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g)];
	const m = matches.at(-1);
	if (!m) throw new Error('ByteRange não encontrado no PDF preparado');
	const [a, b, c, d] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
	return Buffer.concat([preparedPdf.subarray(a, a + b), preparedPdf.subarray(c, c + d)]);
}

/**
 * Produz o `serproCms` (base64) para o PDF preparado, assinando com o
 * certificado de teste indicado. `base: 'rogue'` simula um certificado de CA
 * desconhecida; `'outro-cpf'`, um titular diferente do usuário logado.
 */
export function assinarComoSerpro(
	preparedPdfBase64: string,
	base: 'leaf' | 'outro-cpf' | 'supervisor' | 'rogue' = 'leaf'
): string {
	const { cert, key } = carregarCertTeste(base);
	const conteudo = bytesDoByteRange(Buffer.from(preparedPdfBase64, 'base64'));

	const p7 = forge.pkcs7.createSignedData();
	p7.content = forge.util.createBuffer(conteudo.toString('latin1'));
	p7.addCertificate(cert);
	p7.addSigner({
		key: forge.pki.privateKeyToPem(key),
		certificate: cert,
		digestAlgorithm: forge.pki.oids.sha256,
		authenticatedAttributes: [
			{ type: forge.pki.oids.contentType, value: forge.pki.oids.data },
			// messageDigest e signingTime sem `value`: o forge calcula o digest a
			// partir de p7.content e usa o relógio corrente no sign().
			{ type: forge.pki.oids.messageDigest },
			{ type: forge.pki.oids.signingTime }
		]
	});
	p7.sign({ detached: true });

	const der = forge.asn1.toDer(p7.toAsn1()).getBytes();
	return Buffer.from(der, 'binary').toString('base64');
}
