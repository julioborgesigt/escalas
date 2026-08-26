import { describe, it, expect } from 'vitest';
import zlib from 'node:zlib';
import { PDFDocument } from 'pdf-lib';
import { adicionarPaginaAuditoria, type AuditTrailOptions } from '../pdf-signing-visual';

// JPEG 1×1 válido (para o signatário avançado COM selfie).
const JPEG_1X1 =
	'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAAv/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAT8AH//Z';

/** Extrai o texto (operadores Tj) de todos os content streams do PDF. */
function extrairTexto(bytes: Uint8Array): string {
	const buf = Buffer.from(bytes);
	let out = '';
	let pos = 0;
	while (true) {
		const s = buf.indexOf('stream', pos);
		if (s < 0) break;
		let start = s + 6;
		if (buf[start] === 0x0d) start++;
		if (buf[start] === 0x0a) start++;
		const end = buf.indexOf('endstream', start);
		if (end < 0) break;
		pos = end + 9;
		let data: Buffer;
		try {
			data = zlib.inflateSync(buf.subarray(start, end));
		} catch {
			data = buf.subarray(start, end);
		}
		const str = data.toString('latin1');
		// pdf-lib grava texto como hex string: `<48656C...> Tj`.
		for (const m of str.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) {
			out += Buffer.from(m[1], 'hex').toString('latin1') + '\n';
		}
		// Fallback para strings literais `(texto) Tj`, se houver.
		for (const m of str.matchAll(/\(((?:[^()\\]|\\.)*)\)\s*Tj/g)) {
			out += m[1].replace(/\\([()\\])/g, '$1') + '\n';
		}
	}
	return out;
}

async function basePdf(): Promise<Uint8Array> {
	const doc = await PDFDocument.create();
	doc.addPage([595, 842]);
	return doc.save();
}

describe('adicionarPaginaAuditoria — manifesto do relatório de extra', () => {
	it('lista TODOS os assinantes e omite FOTO quando não há selfie', async () => {
		const signers: AuditTrailOptions[] = [
			{
				// Avançado COM selfie → deve exibir FOTO DO ATO.
				signerName: 'FULANO ENTRADA',
				signingTime: new Date('2026-07-17T11:00:00Z'),
				verificationHash: 'PRES-1-E',
				verificationUrl: 'https://x/validar/PRES-1-E',
				signatureLevel: 'avancada',
				selfieBase64: JPEG_1X1
			},
			{
				// Avançado SEM selfie (foto dispensada) → NÃO deve exibir FOTO DO ATO.
				signerName: 'BELTRANO SAIDA',
				signingTime: new Date('2026-07-17T19:00:00Z'),
				verificationHash: 'PRES-1-S',
				verificationUrl: 'https://x/validar/PRES-1-S',
				signatureLevel: 'avancada'
			},
			{
				// Qualificado (token) → sem bloco de evidências (foto).
				signerName: 'CICLANO SUPERVISOR',
				signingTime: new Date('2026-07-17T20:00:00Z'),
				verificationHash: 'ABCD-1234',
				verificationUrl: 'https://x/validar/ABCD-1234',
				signatureLevel: 'qualificada'
			}
		];

		const out = await adicionarPaginaAuditoria(await basePdf(), signers);
		const texto = extrairTexto(out);

		// (1) Bug 1: os TRÊS assinantes aparecem no manifesto.
		expect(texto).toContain('FULANO ENTRADA');
		expect(texto).toContain('BELTRANO SAIDA');
		expect(texto).toContain('CICLANO SUPERVISOR');

		// (2) Bug 2: "FOTO DO ATO" aparece só para quem tem selfie (o primeiro).
		const fotoCount = (texto.match(/FOTO DO ATO/g) ?? []).length;
		expect(fotoCount).toBe(1);
	});

	it('sem nenhuma selfie, não desenha FOTO DO ATO em lugar nenhum', async () => {
		const signers: AuditTrailOptions[] = [
			{
				signerName: 'UM ENTRADA',
				signingTime: new Date(),
				verificationHash: 'H1',
				verificationUrl: 'https://x/validar/H1',
				signatureLevel: 'avancada'
			}
		];
		const out = await adicionarPaginaAuditoria(await basePdf(), signers);
		const texto = extrairTexto(out);
		expect(texto).toContain('UM ENTRADA');
		expect(texto).not.toContain('FOTO DO ATO');
	});
});
