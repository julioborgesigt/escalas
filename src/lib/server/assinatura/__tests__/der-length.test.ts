import { describe, it, expect } from 'vitest';
import { lerComprimentoDerTotal } from '../pdf-verification';

/**
 * Regressão: o comprimento do CMS deve vir do header DER (não da remoção de
 * zeros finais). Antes, um CMS terminando em 0x00 (ex.: assinatura RSA cujo
 * último byte é 0x00, ~1/256) era truncado e o parse falhava ("too long").
 */
describe('lerComprimentoDerTotal', () => {
	it('forma curta: SEQUENCE len=3, conteúdo terminando em 0x00, com padding', () => {
		// 30 03 02 01 00  (SEQUENCE { INTEGER 0 }) + padding de zeros
		const bytes = Uint8Array.of(0x30, 0x03, 0x02, 0x01, 0x00, 0x00, 0x00, 0x00);
		expect(lerComprimentoDerTotal(bytes)).toBe(5); // header(2) + conteúdo(3)
	});

	it('forma longa (1 byte de comprimento): len=130', () => {
		const conteudo = new Uint8Array(130).fill(0xaa);
		const bytes = new Uint8Array([0x30, 0x81, 0x82, ...conteudo, 0x00, 0x00]);
		expect(lerComprimentoDerTotal(bytes)).toBe(3 + 130); // tag+0x81+0x82 (3) + 130
	});

	it('forma longa (2 bytes de comprimento): len=300', () => {
		const conteudo = new Uint8Array(300).fill(0xbb);
		const bytes = new Uint8Array([0x30, 0x82, 0x01, 0x2c, ...conteudo]);
		expect(lerComprimentoDerTotal(bytes)).toBe(4 + 300);
	});

	it('buffer curto demais → null', () => {
		expect(lerComprimentoDerTotal(Uint8Array.of(0x30))).toBeNull();
	});

	it('comprimento indefinido (0x80) → null', () => {
		expect(lerComprimentoDerTotal(Uint8Array.of(0x30, 0x80, 0x00, 0x00))).toBeNull();
	});

	it('bytes de comprimento estouram o buffer → null', () => {
		// diz "4 bytes de comprimento" mas só há 2 depois
		expect(lerComprimentoDerTotal(Uint8Array.of(0x30, 0x84, 0x00, 0x00))).toBeNull();
	});
});
