import { describe, it, expect } from 'vitest';
import zlib from 'node:zlib';
import { montarTermoPresencaAvancado, prepararTermoPresencaAvancado } from '../termo-presenca';

// JPEG 1×1 válido (selfie/prova de vida) e PNG 1×1 (rubrica).
const JPEG_1X1 =
	'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAAv/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAT8AH//Z';
const RUBRICA_PNG =
	'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

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
		for (const m of str.matchAll(/\(((?:[^()\\]|\\.)*)\)\s*Tj/g)) {
			out += m[1].replace(/\\([()\\])/g, '$1') + '\n';
		}
	}
	return out;
}

describe('montarTermoPresencaAvancado — comprovante de presença sob demanda', () => {
	it('gera termo AVANÇADO com rubrica, foto e base legal correta', async () => {
		const pdf = await montarTermoPresencaAvancado({
			tipo: 'entrada',
			presencaId: 42,
			giseId: 7,
			dataInicio: '2026-07-17',
			unidadeNome: 'DELEGACIA DE IGUATU',
			signerName: 'FULANO DE TAL',
			signerCpf: '12345678901',
			matricula: '301.095-1',
			timestampISO: '2026-07-17T11:00:00Z',
			rubricaBase64: RUBRICA_PNG,
			selfieBase64: JPEG_1X1,
			ip: '203.0.113.7',
			userAgent: 'Mozilla/5.0',
			latitude: -6.36,
			longitude: -39.29,
			origin: 'https://exemplo.test'
		});

		const texto = extrairTexto(pdf);

		// (1) É o termo de presença e traz o servidor.
		expect(texto).toContain('TERMO DE');
		expect(texto).toContain('FULANO DE TAL');

		// (2) Base legal AVANÇADA (art. 4º II) — e NUNCA ICP-Brasil (exclusiva do
		//     fluxo qualificado). Cobre as duas grafias: "ICP-Brasil" e "ICP Brasil"
		//     (o rodapé de identidade usava a segunda, hardcoded — regressão fechada).
		expect(texto).toContain('Lei 14.063/2020');
		expect(texto).not.toMatch(/ICP[\s-]?Brasil/i);

		// (3) A folha de auditoria mostra RÚBRICA e FOTO (selfie presente).
		expect(texto).toMatch(/R\xdaBRICA/);
		expect(texto).toContain('FOTO DO ATO');
	});

	it('sem selfie, não desenha FOTO DO ATO', async () => {
		const pdf = await montarTermoPresencaAvancado({
			tipo: 'saida',
			presencaId: 43,
			giseId: 7,
			dataInicio: '2026-07-17',
			signerName: 'BELTRANO',
			timestampISO: '2026-07-17T19:00:00Z',
			rubricaBase64: RUBRICA_PNG,
			origin: 'https://exemplo.test'
		});
		const texto = extrairTexto(pdf);
		expect(texto).toContain('BELTRANO');
		expect(texto).not.toContain('FOTO DO ATO');
	});
});

describe('prepararTermoPresencaAvancado — duas fases (passkey)', () => {
	it('sem presencaId, o código público não depende de linha no banco', async () => {
		const { verificationHash } = await prepararTermoPresencaAvancado({
			tipo: 'entrada',
			giseId: 7,
			dataInicio: '2026-07-17',
			signerName: 'FULANO DE TAL',
			timestampISO: '2026-07-17T11:00:00Z',
			rubricaBase64: RUBRICA_PNG,
			origin: 'https://exemplo.test'
		});
		expect(verificationHash).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
	});
});
