/**
 * As primitivas que passaram a ser fonte única do projeto.
 *
 * Cada uma existia copiada em vários lugares (comparação timing-safe ×4,
 * SHA-256→hex ×8, geração de token ×2, conversão binária ×7, envelope AES-GCM
 * ×2). Agora que há um único ponto, ele carrega o risco das cópias todas — e é
 * o único lugar onde vale prender o comportamento.
 */
import { describe, it, expect } from 'vitest';
import { comparacaoTimingSafe } from '../timing-safe';
import { sha256Hex } from '../digest';
import { gerarTokenOpaco } from '../token';
import { binStringToBytes, bytesToBinString, bytesToBase64, base64ToBytes } from '../bin';

describe('comparacaoTimingSafe', () => {
	it('aceita apenas strings idênticas', () => {
		expect(comparacaoTimingSafe('segredo', 'segredo')).toBe(true);
		expect(comparacaoTimingSafe('segredo1', 'segredo2')).toBe(false);
	});

	it('comprimento diferente nunca passa, mesmo com prefixo igual', () => {
		expect(comparacaoTimingSafe('curto', 'curtoo')).toBe(false);
		expect(comparacaoTimingSafe('', 'x')).toBe(false);
	});

	it('não colide com o preenchimento — o defeito latente das versões com padEnd("0")', () => {
		// Preenchendo com o CARACTERE '0', "abc" e "abc0" viravam a mesma
		// sequência; só a conferência de comprimento salvava. Aqui as duas
		// proteções são explícitas.
		expect(comparacaoTimingSafe('abc', 'abc0')).toBe(false);
		expect(comparacaoTimingSafe('abc0', 'abc')).toBe(false);
	});

	it('não trunca — segredos que só diferem além do 64º byte são rejeitados', () => {
		// As versões de tamanho fixo cortavam em 64/96 bytes: dois segredos
		// diferentes a partir dali passariam por iguais.
		const base = 'x'.repeat(64);
		expect(comparacaoTimingSafe(base + 'A', base + 'B')).toBe(false);
		const longo = 'y'.repeat(96);
		expect(comparacaoTimingSafe(longo + 'A', longo + 'B')).toBe(false);
	});

	it('dois vazios são iguais (e não estouram o timingSafeEqual)', () => {
		expect(comparacaoTimingSafe('', '')).toBe(true);
	});

	it('compara BYTES UTF-8, não code points', () => {
		expect(comparacaoTimingSafe('café', 'café')).toBe(true);
		expect(comparacaoTimingSafe('café', 'cafe')).toBe(false);
	});
});

describe('sha256Hex', () => {
	it('devolve 64 hex minúsculos e bate com o vetor conhecido de "abc"', async () => {
		const h = await sha256Hex('abc');
		expect(h).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
		expect(h).toMatch(/^[0-9a-f]{64}$/);
	});

	it('aceita bytes e texto com o mesmo resultado', async () => {
		expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe(await sha256Hex('abc'));
	});

	it('é sensível a UTF-8 multibyte', async () => {
		expect(await sha256Hex('café')).not.toBe(await sha256Hex('cafe'));
	});
});

describe('gerarTokenOpaco', () => {
	it('devolve 64 hex chars (32 bytes)', () => {
		expect(gerarTokenOpaco()).toMatch(/^[0-9a-f]{64}$/);
	});

	it('não repete — é a entropia que sustenta sessão, reset e CSRF', () => {
		const amostra = new Set(Array.from({ length: 200 }, () => gerarTokenOpaco()));
		expect(amostra.size).toBe(200);
	});
});

describe('conversões binárias', () => {
	it('binString ↔ bytes é ida e volta', () => {
		const bytes = new Uint8Array([0, 1, 127, 128, 255]);
		expect(binStringToBytes(bytesToBinString(bytes))).toEqual(bytes);
	});

	it('preserva bytes altos (>0x7f), onde uma conversão ingênua corromperia', () => {
		const s = bytesToBinString(new Uint8Array([0xff, 0x80]));
		expect(s.charCodeAt(0)).toBe(0xff);
		expect(s.charCodeAt(1)).toBe(0x80);
	});

	it('base64 ↔ bytes é ida e volta, inclusive com bytes nulos', () => {
		const bytes = new Uint8Array([0, 0, 1, 250, 255]);
		expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
	});

	it('base64 de vazio é vazio', () => {
		expect(bytesToBase64(new Uint8Array(0))).toBe('');
		expect(base64ToBytes('')).toEqual(new Uint8Array(0));
	});
});
