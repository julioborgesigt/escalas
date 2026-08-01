/**
 * Cobertura do /ByteRange (anti shadow-attack).
 *
 * `verificarIntegridadePdf` confere o hash apenas dos trechos que o PRÓPRIO
 * PDF declara no /ByteRange. Sem validar que esses trechos cobrem o arquivo
 * inteiro, um atacante anexa um incremental update após a região assinada
 * (redefinindo páginas/objetos — "hide-and-replace") e a assinatura continua
 * "válida". Estes testes garantem que:
 *   - PDF recém-assinado (sem trailing) passa;
 *   - DSS incremental legítimo (aplicarDss) passa;
 *   - conteúdo anexado arbitrário, redefinição de objetos da revisão
 *     assinada e troca de /Root são rejeitados.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import forge from 'node-forge';
import { PDFDocument } from 'pdf-lib';
import { prepararPdfParaSelo, embedSerproCms } from '../pdf-signing-prepare';
import { avaliarCoberturaAssinatura, extrairCmsDoPdf } from '../pdf-verification';
import { aplicarDss } from '../pades-lt';

const TE = new TextEncoder();

function binToU8(bin: string): Uint8Array {
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) & 0xff;
	return out;
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
	const out = new Uint8Array(a.length + b.length);
	out.set(a, 0);
	out.set(b, a.length);
	return out;
}

let certDer: Uint8Array;

function gerarCmsB64(): string {
	const keys = forge.pki.rsa.generateKeyPair(1024);
	const cert = forge.pki.createCertificate();
	cert.publicKey = keys.publicKey;
	cert.serialNumber = '03';
	cert.validity.notBefore = new Date(Date.now() - 86400000);
	cert.validity.notAfter = new Date(Date.now() + 86400000);
	const subj = [{ name: 'commonName', value: 'TESTE COBERTURA:12345678901' }];
	cert.setSubject(subj);
	cert.setIssuer(subj);
	cert.sign(keys.privateKey, forge.md.sha256.create());
	certDer = binToU8(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes());

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
	return forge.util.encode64(forge.asn1.toDer(p7.toAsn1()).getBytes());
}

let signedPdf: Uint8Array;

beforeAll(async () => {
	const doc = await PDFDocument.create();
	doc.addPage([300, 300]).drawText('coverage test', { x: 30, y: 250 });
	const base = await doc.save();
	const prep = await prepararPdfParaSelo(base, 'TESTE COBERTURA');
	signedPdf = await embedSerproCms(prep.preparedPdf, gerarCmsB64());
});

describe('avaliarCoberturaAssinatura', () => {
	it('aceita PDF recém-assinado (ByteRange até o EOF)', async () => {
		const extr = extrairCmsDoPdf(signedPdf)!;
		expect(extr).not.toBeNull();
		const res = await avaliarCoberturaAssinatura(signedPdf, extr.byteRange);
		expect(res.ok, res.motivo).toBe(true);
	});

	it('aceita DSS incremental legítimo (PAdES-LT via aplicarDss)', async () => {
		const comDss = await aplicarDss(signedPdf, { certs: [certDer], ocsps: [], crls: [] });
		expect(comDss.length).toBeGreaterThan(signedPdf.length); // DSS de fato embarcado
		const extr = extrairCmsDoPdf(comDss)!;
		const res = await avaliarCoberturaAssinatura(comDss, extr.byteRange);
		expect(res.ok, res.motivo).toBe(true);
	});

	it('rejeita conteúdo arbitrário anexado após a assinatura', async () => {
		const adulterado = concat(signedPdf, TE.encode('\nconteudo malicioso\n%%EOF\n'));
		const extr = extrairCmsDoPdf(adulterado)!;
		const res = await avaliarCoberturaAssinatura(adulterado, extr.byteRange);
		expect(res.ok).toBe(false);
	});

	it('rejeita incremental update "DSS" que redefine objeto da revisão assinada', async () => {
		// Simula hide-and-replace: redefine o objeto 1 (existente) num update
		// que se disfarça de DSS.
		const fake =
			'\n1 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\n' +
			'9990 0 obj\n<< /Certs [] /OCSPs [] /CRLs [] >>\nendobj\n' +
			'trailer\n<< /Size 9991 /DSS 9990 0 R >>\nstartxref\n0\n%%EOF\n';
		const adulterado = concat(signedPdf, TE.encode(fake));
		const extr = extrairCmsDoPdf(adulterado)!;
		const res = await avaliarCoberturaAssinatura(adulterado, extr.byteRange);
		expect(res.ok).toBe(false);
		expect(res.motivo).toMatch(/redefine o objeto/);
	});

	it('rejeita incremental update que troca o /Root', async () => {
		const assinadoTxt = new TextDecoder('latin1').decode(signedPdf);
		let rootNum = -1;
		for (const m of assinadoTxt.matchAll(/\/Root\s+(\d+)\s+\d+\s+R/g)) rootNum = parseInt(m[1]);
		expect(rootNum).toBeGreaterThan(0);
		const fake =
			`\n9990 0 obj\n<< /Type /Catalog /Pages 9991 0 R /DSS 9992 0 R >>\nendobj\n` +
			`trailer\n<< /Size 9993 /Root 9990 0 R >>\nstartxref\n0\n%%EOF\n`;
		const adulterado = concat(signedPdf, TE.encode(fake));
		const extr = extrairCmsDoPdf(adulterado)!;
		const res = await avaliarCoberturaAssinatura(adulterado, extr.byteRange);
		expect(res.ok).toBe(false);
		expect(res.motivo).toMatch(/Root/);
	});

	it('rejeita assinatura órfã anexada (CMS com /ByteRange forjado ao final)', async () => {
		const fake = '\n/ByteRange [0 10 20 5]\n%%EOF\n';
		const adulterado = concat(signedPdf, TE.encode(fake));
		// O /ByteRange forjado tem cobertura menor — a principal continua a real.
		const extr = extrairCmsDoPdf(adulterado)!;
		expect(extr.byteRange[2] + extr.byteRange[3]).toBeGreaterThan(35);
		const res = await avaliarCoberturaAssinatura(adulterado, extr.byteRange);
		expect(res.ok).toBe(false);
	});
});
