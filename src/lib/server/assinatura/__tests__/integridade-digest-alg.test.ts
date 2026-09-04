/**
 * O `messageDigest` é conferido no digestAlgorithm que o SIGNATÁRIO declarou.
 *
 * Este teste existe por causa de uma divergência: `crypto-verify` aceita
 * SHA-384/512, `avaliarPoliticaCriptografica` só barra SHA-1, o caminho da TSA já
 * respeitava o OID — e `verificarIntegridadePdf` estava fixo em SHA-256. Um PDF
 * assinado em SHA-384 saía com `assinaturaRsa: true` e `integridade: false`, e o
 * veredito do `/validar` era "Hash do conteúdo do PDF não confere": o portal
 * público ACUSANDO DE ADULTERAÇÃO um documento autêntico.
 *
 * A falha era fechada (nunca aceitou o que devia recusar), então o que se prende
 * aqui são as duas metades: o correto CONFERE em cada algoritmo, e o errado
 * continua sendo recusado em todos.
 */
import { describe, it, expect } from 'vitest';
import { verificarIntegridadePdf } from '../pdf-verification';
import { DIGEST_OIDS } from '../crypto-verify';

const BYTES = new TextEncoder().encode('%PDF-1.7\nconteudo do byte-range assinado\n%%EOF');
const OUTROS_BYTES = new TextEncoder().encode('%PDF-1.7\nconteudo ADULTERADO\n%%EOF');

/** O `messageDigest` como o CMS o carrega: string binária do node-forge. */
async function digestBin(alg: 'SHA-256' | 'SHA-384' | 'SHA-512', bytes = BYTES): Promise<string> {
	const h = new Uint8Array(await crypto.subtle.digest(alg, bytes as unknown as ArrayBuffer));
	return String.fromCharCode(...h);
}

const CASOS = [
	{ alg: 'SHA-256' as const, oid: DIGEST_OIDS.SHA256, bytesDoDigest: 32 },
	{ alg: 'SHA-384' as const, oid: DIGEST_OIDS.SHA384, bytesDoDigest: 48 },
	{ alg: 'SHA-512' as const, oid: DIGEST_OIDS.SHA512, bytesDoDigest: 64 }
];

describe('verificarIntegridadePdf — respeita o digestAlgorithm', () => {
	it.each(CASOS)('$alg: messageDigest correto CONFERE', async ({ alg, oid, bytesDoDigest }) => {
		const md = await digestBin(alg);
		expect(md.length).toBe(bytesDoDigest);
		expect(await verificarIntegridadePdf(BYTES, md, oid)).toBe(true);
	});

	it.each(CASOS)('$alg: conteúdo adulterado é RECUSADO', async ({ alg, oid }) => {
		const mdDeOutroConteudo = await digestBin(alg, OUTROS_BYTES);
		expect(await verificarIntegridadePdf(BYTES, mdDeOutroConteudo, oid)).toBe(false);
	});

	it('OID ausente cai em SHA-256 — o selo institucional e o CMS legado', async () => {
		expect(await verificarIntegridadePdf(BYTES, await digestBin('SHA-256'))).toBe(true);
	});

	/**
	 * A rede de segurança: OID que não reconhecemos vira SHA-256, e aí o
	 * comprimento não casa. "Não reconhecido" nunca resulta em "passou".
	 */
	it('OID desconhecido não vira "passou"', async () => {
		const md = await digestBin('SHA-512');
		expect(await verificarIntegridadePdf(BYTES, md, '1.2.3.4.5.6.7.8')).toBe(false);
	});

	it('digest do algoritmo ERRADO é recusado, mesmo sendo de conteúdo correto', async () => {
		// SHA-512 do conteúdo certo, mas o SignerInfo declara SHA-384: não confere.
		expect(
			await verificarIntegridadePdf(BYTES, await digestBin('SHA-512'), DIGEST_OIDS.SHA384)
		).toBe(false);
	});

	it('messageDigest vazio ou truncado é recusado', async () => {
		expect(await verificarIntegridadePdf(BYTES, '', DIGEST_OIDS.SHA256)).toBe(false);
		const md = await digestBin('SHA-256');
		expect(await verificarIntegridadePdf(BYTES, md.slice(0, 31), DIGEST_OIDS.SHA256)).toBe(false);
	});
});
