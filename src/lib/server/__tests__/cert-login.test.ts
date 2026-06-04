/**
 * Testes da verificação criptográfica do login por Token A3 (cert-login.ts).
 *
 * Regressão do bypass crítico: antes, `/verificar` apenas lia o CPF do subject
 * do certificado e criava a sessão — sem checar a assinatura nem o vínculo ao
 * nonce. Estes testes constroem CMS reais com node-forge (mesmo padrão de
 * pdf-signing-prepare.test.ts) e garantem que:
 *   - um CMS válido, assinado sobre o nonce do desafio, é aceito;
 *   - um CMS válido porém NÃO vinculado a ESTE nonce é rejeitado (anti-replay);
 *   - um CMS adulterado / não-CMS é rejeitado.
 */
import { describe, it, expect } from 'vitest';
import forge from 'node-forge';
import { verificarRespostaDesafioCertificado } from '../cert-login';

/** hex → string binária (cada par de hex = 1 byte), p/ forge.util.createBuffer. */
function hexParaBin(hex: string): string {
	let out = '';
	for (let i = 0; i < hex.length; i += 2) {
		out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
	}
	return out;
}

function sha256Hex(bin: string): string {
	const md = forge.md.sha256.create();
	md.update(bin);
	return md.digest().toHex();
}

/**
 * Constrói um CMS PKCS#7 detached assinando `conteudoBin` — como o Assinador
 * SERPRO faz no login (type:'hash'): o `messageDigest` resultante é
 * `SHA-256(conteudoBin)`. O CPF vai no atributo serialNumber do subject
 * (padrão ICP-Brasil para e-CPF).
 */
function gerarCmsAssinado(conteudoBin: string, cpf: string, commonName = 'FULANO DE TAL'): string {
	const keys = forge.pki.rsa.generateKeyPair(1024);
	const cert = forge.pki.createCertificate();
	cert.publicKey = keys.publicKey;
	cert.serialNumber = '0A';
	cert.validity.notBefore = new Date(Date.now() - 86400000);
	cert.validity.notAfter = new Date(Date.now() + 86400000);
	const subj = [
		{ name: 'commonName', value: commonName },
		{ type: '2.5.4.5', value: cpf }
	];
	cert.setSubject(subj);
	cert.setIssuer(subj);
	cert.sign(keys.privateKey, forge.md.sha256.create());

	const p7 = forge.pkcs7.createSignedData();
	p7.content = forge.util.createBuffer(conteudoBin);
	p7.addCertificate(cert);
	p7.addSigner({
		key: keys.privateKey,
		certificate: cert,
		digestAlgorithm: forge.pki.oids.sha256,
		authenticatedAttributes: [
			{ type: forge.pki.oids.contentType, value: forge.pki.oids.data },
			{ type: forge.pki.oids.messageDigest },
			// forge tipa `value` como string mas aceita Date para signingTime.
			{ type: forge.pki.oids.signingTime, value: new Date() as unknown as string }
		]
	});
	p7.sign({ detached: true });

	return forge.util.encode64(forge.asn1.toDer(p7.toAsn1()).getBytes());
}

// Nonce do desafio (hex de 32 bytes, como `gerarToken()`); o cliente assina
// SHA-256 dos BYTES decodificados — então é isso que vai no messageDigest e o
// que `/iniciar` grava em `desafio.codigo`.
const NONCE_HEX = 'a1b2c3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccddeeff00';
const NONCE_BIN = hexParaBin(NONCE_HEX);
const DIGEST_ESPERADO = sha256Hex(NONCE_BIN);
const CPF = '12345678901';

describe('verificarRespostaDesafioCertificado', () => {
	it('aceita um CMS válido assinado sobre o nonce do desafio', async () => {
		const cms = gerarCmsAssinado(NONCE_BIN, CPF, 'MARIA DA SILVA');
		const r = await verificarRespostaDesafioCertificado(cms, DIGEST_ESPERADO);
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect(r.cpf).toBe(CPF);
			expect(r.nome).toBe('MARIA DA SILVA');
		}
	});

	it('rejeita um CMS válido NÃO vinculado a este nonce (anti-replay)', async () => {
		// Assinatura perfeitamente válida, mas sobre OUTRO conteúdo: o desafio
		// atual esperava o digest do seu próprio nonce. Este é o cerne do fix —
		// posse de chave sozinha não basta; tem de cobrir ESTE desafio.
		const outroNonceBin = hexParaBin('ff'.repeat(32));
		const cms = gerarCmsAssinado(outroNonceBin, CPF);
		const r = await verificarRespostaDesafioCertificado(cms, DIGEST_ESPERADO);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.motivo).toBe('nonce_nao_confere');
	});

	it('rejeita quando o digest esperado está vazio', async () => {
		const cms = gerarCmsAssinado(NONCE_BIN, CPF);
		const r = await verificarRespostaDesafioCertificado(cms, '');
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.motivo).toBe('nonce_nao_confere');
	});

	it('rejeita entrada que não é um CMS', async () => {
		const r = await verificarRespostaDesafioCertificado(
			forge.util.encode64('isto não é um CMS PKCS#7'),
			DIGEST_ESPERADO
		);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.motivo).toBe('cms_invalido');
	});

	it('rejeita um CMS com a assinatura adulterada', async () => {
		const cms = gerarCmsAssinado(NONCE_BIN, CPF);
		// Corrompe um byte no último quarto do DER (região da assinatura RSA),
		// preservando o comprimento — a estrutura ainda parseia, mas a assinatura
		// não confere mais.
		const der = forge.util.decode64(cms);
		const bytes = der.split('');
		const pos = Math.floor(bytes.length * 0.9);
		bytes[pos] = String.fromCharCode(bytes[pos].charCodeAt(0) ^ 0xff);
		const cmsAdulterado = forge.util.encode64(bytes.join(''));
		const r = await verificarRespostaDesafioCertificado(cmsAdulterado, DIGEST_ESPERADO);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(['assinatura_invalida', 'cms_invalido']).toContain(r.motivo);
	});
});
