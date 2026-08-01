/**
 * Regressão do conversor BER→DER (`berToDer`, exercido por `embedSerproCms`).
 *
 * O Assinador SERPRO devolve o CMS em BER com comprimentos INDEFINIDOS nos
 * wrappers (30 80 … 00 00). O Adobe e o parser estrito exigem DER. Se o
 * conversor tropeça e cai no fallback "usa o BER original", o `parseCms`
 * estrito rejeita o CMS e o usuário vê "Estrutura CMS embarcada está malformada".
 *
 * Este teste constrói um CMS válido, reescreve TODOS os elementos construídos
 * como indefinidos (pior caso, mais agressivo que o SERPRO) e confirma que o
 * pipeline real (prepararPdfParaSelo → embedSerproCms → extrairCmsDoPdf →
 * parseCms) produz um CMS DER parseável.
 */

import { describe, it, expect } from 'vitest';
import forge from 'node-forge';
import { PDFDocument } from 'pdf-lib';
import { prepararPdfParaSelo, embedSerproCms } from '../pdf-signing-prepare';
import { extrairCmsDoPdf, parseCms } from '../pdf-verification';

function concat(parts: Uint8Array[]): Uint8Array {
	let total = 0;
	for (const p of parts) total += p.length;
	const out = new Uint8Array(total);
	let off = 0;
	for (const p of parts) {
		out.set(p, off);
		off += p.length;
	}
	return out;
}

function encLen(len: number): Uint8Array {
	if (len < 0x80) return Uint8Array.from([len]);
	if (len < 0x100) return Uint8Array.from([0x81, len]);
	if (len < 0x10000) return Uint8Array.from([0x82, len >> 8, len & 0xff]);
	return Uint8Array.from([0x83, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff]);
}

/** Reescreve TODO elemento construído de um DER como comprimento indefinido (BER). */
function toIndefiniteBer(der: Uint8Array): Uint8Array {
	let pos = 0;
	function read(): Uint8Array {
		const tag = der[pos++];
		const lb = der[pos++];
		let len: number;
		if (lb < 0x80) {
			len = lb;
		} else {
			const n = lb & 0x7f;
			len = 0;
			for (let i = 0; i < n; i++) len = (len << 8) | der[pos++];
		}
		const valueStart = pos;
		const valueEnd = pos + len;
		const constructed = (tag & 0x20) !== 0;
		if (!constructed) {
			pos = valueEnd;
			return concat([Uint8Array.from([tag]), encLen(len), der.subarray(valueStart, valueEnd)]);
		}
		const children: Uint8Array[] = [];
		while (pos < valueEnd) children.push(read());
		// tag, 0x80 (indefinido), filhos…, 00 00 (EOC)
		return concat([Uint8Array.from([tag, 0x80]), concat(children), Uint8Array.from([0, 0])]);
	}
	return read();
}

function binToU8(bin: string): Uint8Array {
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) & 0xff;
	return out;
}

function gerarCmsDer(): Uint8Array {
	const keys = forge.pki.rsa.generateKeyPair(1024);
	const cert = forge.pki.createCertificate();
	cert.publicKey = keys.publicKey;
	cert.serialNumber = '02';
	cert.validity.notBefore = new Date(Date.now() - 86400000);
	cert.validity.notAfter = new Date(Date.now() + 86400000);
	const subj = [{ name: 'commonName', value: 'TESTE BER:12345678901' }];
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
	return binToU8(forge.asn1.toDer(p7.toAsn1()).getBytes());
}

describe('berToDer — CMS SERPRO em BER indefinido → DER parseável', () => {
	it('converte BER de comprimento indefinido e o parseCms estrito aceita', async () => {
		// PDF base mínimo + placeholder de assinatura real.
		const doc = await PDFDocument.create();
		doc.addPage([300, 300]).drawText('ber test', { x: 30, y: 250 });
		const base = await doc.save();
		const prep = await prepararPdfParaSelo(base, 'TESTE BER');

		// CMS válido → reescrito como BER totalmente indefinido (estilo SERPRO, pior caso).
		const der = gerarCmsDer();
		const ber = toIndefiniteBer(der);
		expect(ber).not.toEqual(der); // de fato virou BER indefinido
		const berB64 = forge.util.encode64(String.fromCharCode(...ber));

		// Pipeline real: embedSerproCms chama berToDer internamente.
		const signedPdf = await embedSerproCms(prep.preparedPdf, berB64);

		// Extrai e parseia com o MESMO caminho da finalização (parseCms estrito).
		const extr = extrairCmsDoPdf(signedPdf);
		expect(extr).not.toBeNull();
		const cms = parseCms(extr!.cmsDer);
		expect(cms, 'parseCms deveria aceitar o DER convertido (sem "malformada")').not.toBeNull();
		expect(cms!.messageDigest.length).toBeGreaterThan(0);
		expect(cms!.signatureValue.length).toBeGreaterThan(0);
	});
});
