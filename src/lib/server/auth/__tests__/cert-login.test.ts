/**
 * Testes da verificação criptográfica do login por Token A3 (cert-login.ts).
 *
 * Regressão do bypass crítico: antes, `/verificar` apenas lia o CPF do subject
 * do certificado e criava a sessão — sem checar a assinatura nem o vínculo ao
 * nonce. Estes testes constroem CMS reais com node-forge (mesmo padrão de
 * pdf-signing-prepare.test.ts) e garantem que:
 *   - um CMS válido, assinado sobre o nonce do desafio, é aceito;
 *   - um CMS válido porém NÃO vinculado a ESTE nonce é rejeitado (anti-replay);
 *   - um CMS adulterado / não-CMS é rejeitado;
 *   - um CMS fora da política criptográfica mínima é rejeitado (SHA-1, RSA
 *     abaixo de 2048, certificado sem `keyUsage` de assinatura) — a régua que
 *     `cades-finalizer` e `pdf-verification` já aplicavam e que só este caminho
 *     pulava, apesar de ser o que concede sessão sem senha e sem 2FA.
 *
 * As chaves RSA são geradas UMA VEZ no topo e reusadas: `generateKeyPair(2048)`
 * do node-forge leva segundos, e cada teste que gerasse a sua transformaria este
 * arquivo no mais lento da suíte. O par fraco (1024) existe só para o teste da
 * política.
 */
import { describe, it, expect } from 'vitest';
import forge from 'node-forge';
import { verificarRespostaDesafioCertificado } from '../cert-login';

const PAR_FORTE = forge.pki.rsa.generateKeyPair(2048);
const PAR_FRACO = forge.pki.rsa.generateKeyPair(1024);

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

interface OpcoesCms {
	commonName?: string;
	/** Par RSA do signatário. Default: 2048 bits (dentro da política). */
	par?: forge.pki.rsa.KeyPair;
	/** Digest da assinatura CMS. Default: SHA-256. */
	digest?: 'sha256' | 'sha1';
	/** `false` emite certificado SEM a extensão keyUsage (fora da política). */
	comKeyUsage?: boolean;
}

/**
 * Constrói um CMS PKCS#7 detached assinando `conteudoBin` — como o Assinador
 * SERPRO faz no login (type:'hash'): o `messageDigest` resultante é
 * `SHA-256(conteudoBin)`. O CPF vai no atributo serialNumber do subject
 * (padrão ICP-Brasil para e-CPF).
 *
 * O default produz um certificado DENTRO da política criptográfica mínima
 * (RSA 2048, SHA-256, `keyUsage` com nonRepudiation); as opções existem para os
 * testes que precisam sair dela.
 */
function gerarCmsAssinado(conteudoBin: string, cpf: string, opcoes: OpcoesCms = {}): string {
	const {
		commonName = 'FULANO DE TAL',
		par = PAR_FORTE,
		digest = 'sha256',
		comKeyUsage = true
	} = opcoes;
	const cert = forge.pki.createCertificate();
	cert.publicKey = par.publicKey;
	cert.serialNumber = '0A';
	cert.validity.notBefore = new Date(Date.now() - 86400000);
	cert.validity.notAfter = new Date(Date.now() + 86400000);
	const subj = [
		{ name: 'commonName', value: commonName },
		{ type: '2.5.4.5', value: cpf }
	];
	cert.setSubject(subj);
	cert.setIssuer(subj);
	if (comKeyUsage) {
		// `nonRepudiation` é o bit que o e-CPF de assinatura carrega.
		cert.setExtensions([{ name: 'keyUsage', digitalSignature: true, nonRepudiation: true }]);
	}
	// O certificado é sempre autoassinado em SHA-256; o que o teste varia é o
	// digest da ASSINATURA CMS, que é o que a política lê.
	cert.sign(par.privateKey, forge.md.sha256.create());

	const p7 = forge.pkcs7.createSignedData();
	p7.content = forge.util.createBuffer(conteudoBin);
	p7.addCertificate(cert);
	p7.addSigner({
		key: par.privateKey,
		certificate: cert,
		digestAlgorithm: digest === 'sha1' ? forge.pki.oids.sha1 : forge.pki.oids.sha256,
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
		const cms = gerarCmsAssinado(NONCE_BIN, CPF, { commonName: 'MARIA DA SILVA' });
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

	// ---- Política criptográfica mínima ------------------------------------
	//
	// A mesma régua de `cades-finalizer` e `pdf-verification`. Este caminho
	// concede sessão sem senha e sem 2FA, e era o único dos três que a pulava.

	it('rejeita assinatura CMS em SHA-1', async () => {
		const cms = gerarCmsAssinado(NONCE_BIN, CPF, { digest: 'sha1' });
		const r = await verificarRespostaDesafioCertificado(cms, DIGEST_ESPERADO);
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(r.motivo).toBe('politica_cripto');
			expect(r.detalhe).toContain('SHA-1');
		}
	});

	it('rejeita chave RSA abaixo de 2048 bits', async () => {
		const cms = gerarCmsAssinado(NONCE_BIN, CPF, { par: PAR_FRACO });
		const r = await verificarRespostaDesafioCertificado(cms, DIGEST_ESPERADO);
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(r.motivo).toBe('politica_cripto');
			expect(r.detalhe).toContain('1024');
		}
	});

	it('rejeita certificado sem keyUsage de assinatura', async () => {
		// e-CPF emitido só para autenticação/cifragem: prova posse da chave, mas
		// não é certificado de assinatura.
		const cms = gerarCmsAssinado(NONCE_BIN, CPF, { comKeyUsage: false });
		const r = await verificarRespostaDesafioCertificado(cms, DIGEST_ESPERADO);
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(r.motivo).toBe('politica_cripto');
			expect(r.detalhe).toContain('keyUsage');
		}
	});

	it('recusa pela política ANTES de conferir o nonce', async () => {
		// Ordem importa: a política é barata (OID, tamanho de módulo, extensão) e
		// recusa sem importar chave nem verificar curva. Um CMS fora da política E
		// fora do desafio tem de sair por `politica_cripto`.
		const outroNonceBin = hexParaBin('ff'.repeat(32));
		const cms = gerarCmsAssinado(outroNonceBin, CPF, { par: PAR_FRACO });
		const r = await verificarRespostaDesafioCertificado(cms, DIGEST_ESPERADO);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.motivo).toBe('politica_cripto');
	});
});
