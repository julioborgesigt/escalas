/**
 * Testes do selo institucional (assinatura avançada, Lei 14.063/2020 art. 4º II).
 *
 * Valida o caminho COMPLETO: prepararPdfParaSelo → assinatura server-side com a
 * chave institucional → CMS embarcado → verificação criptográfica. Se a
 * assinatura do hash pré-calculado (fake-md) estivesse errada, a checagem RSA
 * falharia — então este teste é a prova de que o selo produz um CMS válido.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import forge from 'node-forge';
import { PDFDocument } from 'pdf-lib';
import {
	selarPdfInstitucional,
	carregarSeloInstitucional,
	verificarSeloInstitucional
} from '../server-seal';
import {
	extrairCmsDoPdf,
	parseCms,
	verificarIntegridadePdf,
	verificarAssinaturaCmsAsync
} from '../pdf-verification';

/** Gera um bundle base64 (chave PEM + cert PEM) igual ao do script de geração. */
function gerarBundleSelo(cn = 'Selo Teste PCCE'): string {
	const keys = forge.pki.rsa.generateKeyPair(2048);
	const cert = forge.pki.createCertificate();
	cert.publicKey = keys.publicKey;
	cert.serialNumber = '01';
	cert.validity.notBefore = new Date(Date.now() - 86_400_000);
	cert.validity.notAfter = new Date(Date.now() + 10 * 365 * 86_400_000);
	const attrs = [
		{ name: 'commonName', value: cn },
		{ name: 'organizationName', value: 'Teste' },
		{ name: 'countryName', value: 'BR' }
	];
	cert.setSubject(attrs);
	cert.setIssuer(attrs);
	cert.setExtensions([
		{ name: 'basicConstraints', cA: false },
		{ name: 'keyUsage', digitalSignature: true, nonRepudiation: true }
	]);
	cert.sign(keys.privateKey, forge.md.sha256.create());
	const keyPem = forge.pki.privateKeyToPem(keys.privateKey);
	const certPem = forge.pki.certificateToPem(cert);
	return forge.util.encode64(keyPem.trim() + '\n' + certPem.trim());
}

async function pdfMinimo(): Promise<Uint8Array> {
	const doc = await PDFDocument.create();
	const page = doc.addPage([595, 842]);
	page.drawText('Documento de teste — escala em tela', { x: 50, y: 800, size: 12 });
	return doc.save();
}

describe('selarPdfInstitucional', () => {
	let bundle: string;
	beforeAll(() => {
		bundle = gerarBundleSelo();
	});

	it('sem env configurada → ok:false (degrada para rodapé honesto)', async () => {
		const r = await selarPdfInstitucional(await pdfMinimo(), 'FULANO', { env: {} });
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.motivo).toBe('nao_configurado');
	});

	it('com env → sela com CMS criptograficamente válido (integridade + RSA)', async () => {
		const r = await selarPdfInstitucional(await pdfMinimo(), 'FULANO DE TAL', {
			env: { SELO_INSTITUCIONAL_PEM: bundle }
		});
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.tipoCarimboTempo).toBe('servidor'); // sem TSA_URL no teste

		const extra = extrairCmsDoPdf(r.pdf);
		expect(extra).not.toBeNull();
		const cms = parseCms(extra!.cmsDer);
		expect(cms).not.toBeNull();

		// Integridade: hash do byte-range confere com o messageDigest assinado.
		expect(await verificarIntegridadePdf(extra!.bytesAssinados, cms!.messageDigest)).toBe(true);
		// Assinatura RSA dos SignedAttributes confere com a chave pública do selo.
		expect(
			await verificarAssinaturaCmsAsync(
				cms!.certificate,
				cms!.sigAlgOid,
				cms!.signedAttrsAsSet,
				cms!.signatureValue,
				cms!.digestAlgOid
			)
		).toBe(true);
		expect(cms!.certificate.subject.getField('CN')?.value as string).toContain('Selo Teste');
	});

	it('adulteração do conteúdo quebra a integridade', async () => {
		const r = await selarPdfInstitucional(await pdfMinimo(), 'FULANO', {
			env: { SELO_INSTITUCIONAL_PEM: bundle }
		});
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		const tampered = new Uint8Array(r.pdf);
		tampered[40] ^= 0xff; // flip de um byte no conteúdo assinado (header/objeto inicial)
		const extra = extrairCmsDoPdf(tampered);
		expect(extra).not.toBeNull();
		const cms = parseCms(extra!.cmsDer);
		expect(cms).not.toBeNull();
		expect(await verificarIntegridadePdf(extra!.bytesAssinados, cms!.messageDigest)).toBe(false);
	});

	it('bundle inválido → carregarSeloInstitucional devolve null (não lança)', () => {
		expect(carregarSeloInstitucional({ SELO_INSTITUCIONAL_PEM: 'lixo-nao-base64-!!!' })).toBeNull();
	});
});

describe('verificarSeloInstitucional', () => {
	let bundle: string;
	beforeAll(() => {
		bundle = gerarBundleSelo();
	});

	it('selo íntegro e autêntico quando verificado com a mesma chave', async () => {
		const r = await selarPdfInstitucional(await pdfMinimo(), 'FULANO', {
			env: { SELO_INSTITUCIONAL_PEM: bundle }
		});
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		const v = await verificarSeloInstitucional(r.pdf, { SELO_INSTITUCIONAL_PEM: bundle });
		expect(v.presente).toBe(true);
		expect(v.integro).toBe(true);
		expect(v.autentico).toBe(true);
		expect(v.cn).toContain('Selo Teste');
	});

	it('íntegro mas NÃO autêntico quando o servidor tem outra chave', async () => {
		const r = await selarPdfInstitucional(await pdfMinimo(), 'FULANO', {
			env: { SELO_INSTITUCIONAL_PEM: bundle }
		});
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		const outraChave = gerarBundleSelo('Outro Selo Qualquer');
		const v = await verificarSeloInstitucional(r.pdf, { SELO_INSTITUCIONAL_PEM: outraChave });
		expect(v.presente).toBe(true);
		expect(v.integro).toBe(true); // o selo é internamente válido (não adulterado)
		expect(v.autentico).toBe(false); // mas não é o selo deste servidor
	});

	it('adulteração → presente mas não íntegro', async () => {
		const r = await selarPdfInstitucional(await pdfMinimo(), 'FULANO', {
			env: { SELO_INSTITUCIONAL_PEM: bundle }
		});
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		const tampered = new Uint8Array(r.pdf);
		tampered[40] ^= 0xff;
		const v = await verificarSeloInstitucional(tampered, { SELO_INSTITUCIONAL_PEM: bundle });
		expect(v.presente).toBe(true);
		expect(v.integro).toBe(false);
	});

	it('shadow-attack (conteúdo anexado após a assinatura) → não íntegro', async () => {
		// Regressão da lacuna do parecer: sem a checagem de cobertura, bytes
		// acrescentados após a região assinada passavam por verificarIntegridadePdf
		// (que só cobre o /ByteRange declarado) e o selo reportava integro:true.
		const r = await selarPdfInstitucional(await pdfMinimo(), 'FULANO', {
			env: { SELO_INSTITUCIONAL_PEM: bundle }
		});
		expect(r.ok).toBe(true);
		if (!r.ok) return;

		const injecao = new TextEncoder().encode('\n% conteudo injetado apos a assinatura\n');
		const comShadow = new Uint8Array(r.pdf.length + injecao.length);
		comShadow.set(r.pdf, 0);
		comShadow.set(injecao, r.pdf.length);

		// O byte-range assinado permanece intacto → integridade "local" ainda passa...
		const extra = extrairCmsDoPdf(comShadow);
		expect(extra).not.toBeNull();
		const cms = parseCms(extra!.cmsDer);
		expect(await verificarIntegridadePdf(extra!.bytesAssinados, cms!.messageDigest)).toBe(true);

		// ...mas a cobertura pega o conteúdo anexado e o selo é reprovado.
		const v = await verificarSeloInstitucional(comShadow, { SELO_INSTITUCIONAL_PEM: bundle });
		expect(v.presente).toBe(true);
		expect(v.integro).toBe(false);
	});

	it('PDF sem selo (rodapé honesto puro) → presente:false', async () => {
		const v = await verificarSeloInstitucional(await pdfMinimo(), {
			SELO_INSTITUCIONAL_PEM: bundle
		});
		expect(v.presente).toBe(false);
	});
});
