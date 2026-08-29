/**
 * A TABELA DE DESPACHO de `verificarAssinaturaCms` — qual OID vira qual
 * família de algoritmo, qual digest e qual curva.
 *
 * `crypto-verify.test.ts`, ao lado, cobre o caminho RSA PKCS#1 com SHA-256 de
 * ponta a ponta e o OID desconhecido. Para RSA-PSS e ECDSA ele assume uma
 * limitação, escrita lá: "testá-los end-to-end exige construir certs com chave
 * EC/PSS, o que forge não suporta fluentemente" — e por isso assere apenas
 * `false`, com um certificado RSA no lugar.
 *
 * Asserção de `false` num caso que falharia de qualquer jeito não distingue
 * despacho CERTO que falhou de despacho ERRADO que falhou. Foi o que a
 * varredura de mutação mediu: 24 sobreviventes em 38, quase todos nas
 * comparações de OID — trocar `===` por `!==` em qualquer linha da tabela
 * deixava a suíte verde.
 *
 * Este arquivo fecha isso exercitando assinaturas VERDADEIRAS em cada
 * algoritmo. Duas descobertas tornaram possível o que o comentário dava como
 * inviável:
 *
 *   - o forge recusa parsear certificado EC ("Cannot read public key. OID is
 *     not RSA"), mas `certificateToAsn1` devolve `cert.tbsCertificate` quando
 *     esse campo existe — e é só dali que o código lê o SPKI no caminho ECDSA.
 *     Um objeto com o TBS montado à mão basta, e é um dublê honesto: a função
 *     não usa mais nada do certificado nesse caminho;
 *   - a chave RSA do forge atravessa para o Web Crypto via PKCS#8, o que
 *     permite assinar com PSS de verdade.
 */

import { describe, it, expect } from 'vitest';
import forge from 'node-forge';
import { verificarAssinaturaCms, SIGNATURE_OIDS, DIGEST_OIDS } from '../crypto-verify';

const { Class, Type } = forge.asn1;

/** OID de ecdsa-with-SHA256 — usado só para dar um envelope válido ao dublê. */
const OID_ECDSA_SHA256 = '1.2.840.10045.4.3.2';

/** SET de SignedAttributes qualquer — o conteúdo não importa, só ser estável. */
function signedAttrs(marca = 42): forge.asn1.Asn1 {
	return forge.asn1.create(Class.UNIVERSAL, Type.SET, true, [
		forge.asn1.create(Class.UNIVERSAL, Type.INTEGER, false, String.fromCharCode(marca))
	]);
}

function derBytes(asn1: forge.asn1.Asn1): Uint8Array {
	const bin = forge.asn1.toDer(asn1).getBytes();
	return Uint8Array.from(bin, (c) => c.charCodeAt(0) & 0xff);
}

// ── RSA ─────────────────────────────────────────────────────────────────────

function certRsa(): { cert: forge.pki.Certificate; chave: forge.pki.rsa.PrivateKey } {
	const keys = forge.pki.rsa.generateKeyPair(2048);
	const cert = forge.pki.createCertificate();
	cert.publicKey = keys.publicKey;
	cert.serialNumber = '01';
	cert.validity.notBefore = new Date(Date.now() - 86_400_000);
	cert.validity.notAfter = new Date(Date.now() + 86_400_000);
	const subj = [{ name: 'commonName', value: 'TESTE ALGORITMOS' }];
	cert.setSubject(subj);
	cert.setIssuer(subj);
	cert.sign(keys.privateKey, forge.md.sha256.create());
	return { cert, chave: keys.privateKey };
}

const MD_POR_NOME = {
	'SHA-1': () => forge.md.sha1.create(),
	'SHA-256': () => forge.md.sha256.create(),
	'SHA-384': () => forge.md.sha384.create(),
	'SHA-512': () => forge.md.sha512.create()
} as const;

/** Assina o DER do SET com PKCS#1 v1.5 e o digest pedido. */
function assinarPkcs1(
	chave: forge.pki.rsa.PrivateKey,
	attrs: forge.asn1.Asn1,
	hash: keyof typeof MD_POR_NOME
): string {
	const md = MD_POR_NOME[hash]();
	md.update(forge.asn1.toDer(attrs).getBytes());
	return chave.sign(md);
}

/** Chave privada do forge → CryptoKey de RSA-PSS, via PKCS#8. */
async function chavePssDoForge(chave: forge.pki.rsa.PrivateKey, hash: string): Promise<CryptoKey> {
	const pkcs8 = forge.pki.wrapRsaPrivateKey(forge.pki.privateKeyToAsn1(chave));
	const der = derBytes(pkcs8);
	return crypto.subtle.importKey('pkcs8', der as BufferSource, { name: 'RSA-PSS', hash }, false, [
		'sign'
	]);
}

// ── ECDSA ───────────────────────────────────────────────────────────────────

/**
 * Dublê de certificado com chave EC. Só `tbsCertificate` é preenchido porque é
 * o único campo que o caminho ECDSA lê — via `certificateToAsn1`, que devolve
 * esse ASN.1 verbatim quando ele existe.
 */
async function certEc(curva: 'P-256' | 'P-384' | 'P-521') {
	const par = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: curva }, true, [
		'sign',
		'verify'
	]);
	const spkiDer = new Uint8Array(await crypto.subtle.exportKey('spki', par.publicKey));
	const spki = forge.asn1.fromDer(forge.util.createBuffer(String.fromCharCode(...spkiDer)));
	const vazio = forge.asn1.create(Class.UNIVERSAL, Type.SEQUENCE, true, []);
	// O código pega `tbs.value[6]`; os seis primeiros campos só precisam existir.
	const tbs = forge.asn1.create(Class.UNIVERSAL, Type.SEQUENCE, true, [
		vazio,
		vazio,
		vazio,
		vazio,
		vazio,
		vazio,
		spki
	]);
	return {
		cert: {
			tbsCertificate: tbs,
			// `certificateToAsn1` monta `[tbs, AlgorithmIdentifier, BITSTRING]`; sem
			// estes dois ele lança ao serializar o envelope, o `catch` da verificação
			// engole a exceção e devolve `false` — uma recusa que pareceria do
			// algoritmo e viria da fixture.
			signatureOid: OID_ECDSA_SHA256,
			signature: '\x00'
		} as unknown as forge.pki.Certificate,
		privada: par.privateKey
	};
}

/**
 * P1363 (`r||s` de tamanho fixo) → `SEQUENCE { INTEGER r, INTEGER s }`.
 *
 * É o inverso do que `ecdsaAsn1ToP1363` faz no código: o Web Crypto assina em
 * P1363, o CMS carrega DER. Passar pelo DER é o que exercita a conversão sob
 * teste, inclusive o corte do byte de sinal e o pad à esquerda.
 */
function p1363ParaDer(sig: Uint8Array): string {
	const n = sig.length / 2;
	const inteiro = (b: Uint8Array) => {
		let i = 0;
		while (i < b.length - 1 && b[i] === 0) i++;
		let v = b.slice(i);
		if (v[0] & 0x80) {
			// DER exige byte 0x00 à frente para não virar negativo.
			const comSinal = new Uint8Array(v.length + 1);
			comSinal.set(v, 1);
			v = comSinal;
		}
		return forge.asn1.create(Class.UNIVERSAL, Type.INTEGER, false, String.fromCharCode(...v));
	};
	return forge.asn1
		.toDer(
			forge.asn1.create(Class.UNIVERSAL, Type.SEQUENCE, true, [
				inteiro(sig.slice(0, n)),
				inteiro(sig.slice(n))
			])
		)
		.getBytes();
}

// ── Testes ──────────────────────────────────────────────────────────────────

describe('despacho RSA PKCS#1 — cada OID combinado usa o SEU digest', () => {
	/**
	 * Assinatura VÁLIDA feita com o digest que o OID anuncia. Se o mapeamento
	 * OID → digest trocar de linha, o hash conferido deixa de ser o assinado e
	 * a verificação cai. É isso que prende a tabela.
	 */
	const casos = [
		[SIGNATURE_OIDS.SHA1_RSA, 'SHA-1'],
		[SIGNATURE_OIDS.SHA256_RSA, 'SHA-256'],
		[SIGNATURE_OIDS.SHA384_RSA, 'SHA-384'],
		[SIGNATURE_OIDS.SHA512_RSA, 'SHA-512']
	] as const;

	for (const [oid, hash] of casos) {
		it(`${hash}withRSA verifica com assinatura ${hash}`, async () => {
			const { cert, chave } = certRsa();
			const attrs = signedAttrs();
			const ok = await verificarAssinaturaCms({
				cert,
				sigAlgOid: oid,
				signedAttrsAsSet: attrs,
				signatureValue: assinarPkcs1(chave, attrs, hash)
			});
			expect(ok).toBe(true);
		});
	}

	/** Digest trocado: a assinatura é matematicamente boa, mas de outro hash. */
	it('assinatura feita com digest diferente do que o OID anuncia é recusada', async () => {
		const { cert, chave } = certRsa();
		const attrs = signedAttrs();
		const ok = await verificarAssinaturaCms({
			cert,
			sigAlgOid: SIGNATURE_OIDS.SHA256_RSA,
			signedAttrsAsSet: attrs,
			signatureValue: assinarPkcs1(chave, attrs, 'SHA-512')
		});
		expect(ok).toBe(false);
	});
});

describe('despacho rsaEncryption — o digest vem do SignerInfo', () => {
	/**
	 * O OID 1.2.840.113549.1.1.1 não embute digest; ele sai do
	 * `digestAlgorithm` do SignerInfo. São duas tabelas diferentes, e esta é a
	 * segunda.
	 */
	const casos = [
		[DIGEST_OIDS.SHA1, 'SHA-1'],
		[DIGEST_OIDS.SHA256, 'SHA-256'],
		[DIGEST_OIDS.SHA384, 'SHA-384'],
		[DIGEST_OIDS.SHA512, 'SHA-512']
	] as const;

	for (const [digestOid, hash] of casos) {
		it(`digestAlgOid ${hash} verifica com assinatura ${hash}`, async () => {
			const { cert, chave } = certRsa();
			const attrs = signedAttrs();
			const ok = await verificarAssinaturaCms({
				cert,
				sigAlgOid: SIGNATURE_OIDS.RSA_ENCRYPTION,
				signedAttrsAsSet: attrs,
				signatureValue: assinarPkcs1(chave, attrs, hash),
				digestAlgOid: digestOid
			});
			expect(ok).toBe(true);
		});
	}

	/** Sem digestAlgOid o hash é indeterminado — recusa, não adivinha. */
	it('sem digestAlgOid a verificação é recusada', async () => {
		const { cert, chave } = certRsa();
		const attrs = signedAttrs();
		const ok = await verificarAssinaturaCms({
			cert,
			sigAlgOid: SIGNATURE_OIDS.RSA_ENCRYPTION,
			signedAttrsAsSet: attrs,
			signatureValue: assinarPkcs1(chave, attrs, 'SHA-256')
		});
		expect(ok).toBe(false);
	});
});

describe('despacho RSA-PSS', () => {
	/**
	 * PSS não é PKCS#1 com outro nome: o padding é diferente e a verificação
	 * roda por Web Crypto, com `saltLength` igual ao tamanho do digest
	 * (DOC-ICP-15.03). Uma assinatura PSS real é o que separa "reconheceu o
	 * OID" de "verificou de verdade".
	 */
	it('assinatura PSS verdadeira é aceita', async () => {
		const { cert, chave } = certRsa();
		const attrs = signedAttrs();
		const key = await chavePssDoForge(chave, 'SHA-256');
		const sig = new Uint8Array(
			await crypto.subtle.sign(
				{ name: 'RSA-PSS', saltLength: 32 },
				key,
				derBytes(attrs) as BufferSource
			)
		);
		const ok = await verificarAssinaturaCms({
			cert,
			sigAlgOid: SIGNATURE_OIDS.RSA_PSS,
			signedAttrsAsSet: attrs,
			signatureValue: String.fromCharCode(...sig)
		});
		expect(ok).toBe(true);
	});

	/** A mesma chave, o mesmo digest — só o padding difere. */
	it('assinatura PKCS#1 apresentada como PSS é recusada', async () => {
		const { cert, chave } = certRsa();
		const attrs = signedAttrs();
		const ok = await verificarAssinaturaCms({
			cert,
			sigAlgOid: SIGNATURE_OIDS.RSA_PSS,
			signedAttrsAsSet: attrs,
			signatureValue: assinarPkcs1(chave, attrs, 'SHA-256')
		});
		expect(ok).toBe(false);
	});
});

describe('despacho ECDSA — curva e digest saem do certificado e do OID', () => {
	/**
	 * Cada curva tem um tamanho de coordenada próprio (32/48/66 bytes), e é ele
	 * que dimensiona a conversão DER → P1363. Curva lida errada, ou digest
	 * trocado, e a verificação cai.
	 */
	const casos = [
		['P-256', SIGNATURE_OIDS.ECDSA_SHA256, 'SHA-256'],
		['P-384', SIGNATURE_OIDS.ECDSA_SHA384, 'SHA-384'],
		['P-521', SIGNATURE_OIDS.ECDSA_SHA512, 'SHA-512']
	] as const;

	for (const [curva, oid, hash] of casos) {
		it(`${curva} com ${hash} verifica assinatura verdadeira`, async () => {
			const { cert, privada } = await certEc(curva);
			const attrs = signedAttrs();
			const sig = new Uint8Array(
				await crypto.subtle.sign({ name: 'ECDSA', hash }, privada, derBytes(attrs) as BufferSource)
			);
			const ok = await verificarAssinaturaCms({
				cert,
				sigAlgOid: oid,
				signedAttrsAsSet: attrs,
				signatureValue: p1363ParaDer(sig)
			});
			expect(ok).toBe(true);
		});
	}

	it('assinatura ECDSA de outro conteúdo é recusada', async () => {
		const { cert, privada } = await certEc('P-256');
		const sig = new Uint8Array(
			await crypto.subtle.sign(
				{ name: 'ECDSA', hash: 'SHA-256' },
				privada,
				new Uint8Array([9, 9, 9]) as BufferSource
			)
		);
		const ok = await verificarAssinaturaCms({
			cert,
			sigAlgOid: SIGNATURE_OIDS.ECDSA_SHA256,
			signedAttrsAsSet: signedAttrs(),
			signatureValue: p1363ParaDer(sig)
		});
		expect(ok).toBe(false);
	});

	/**
	 * A curva do certificado tem de ser a que a assinatura usou. Aqui o
	 * certificado é P-256 e a assinatura, P-384: o `coordLen` derivado do SPKI
	 * dimensiona a conversão, então a discordância aparece.
	 */
	it('curva do certificado diferente da assinatura é recusada', async () => {
		const p256 = await certEc('P-256');
		const p384 = await certEc('P-384');
		const attrs = signedAttrs();
		const sig = new Uint8Array(
			await crypto.subtle.sign(
				{ name: 'ECDSA', hash: 'SHA-384' },
				p384.privada,
				derBytes(attrs) as BufferSource
			)
		);
		const ok = await verificarAssinaturaCms({
			cert: p256.cert,
			sigAlgOid: SIGNATURE_OIDS.ECDSA_SHA384,
			signedAttrsAsSet: attrs,
			signatureValue: p1363ParaDer(sig)
		});
		expect(ok).toBe(false);
	});

	/**
	 * A conversão DER → P1363 tem duas correções de largura, e as duas dependem
	 * do VALOR da assinatura, não da curva:
	 *
	 *   - quando `r` (ou `s`) tem o bit mais alto ligado, o DER acrescenta um
	 *     `0x00` à frente para não virar inteiro negativo — e esse byte precisa
	 *     ser cortado, senão a coordenada sai com um byte a mais;
	 *   - quando `r` é pequeno, o DER omite os zeros à esquerda — e eles
	 *     precisam voltar como pad, senão a coordenada sai curta.
	 *
	 * Assinatura ECDSA é aleatória a cada execução, então esperar que o caso
	 * apareça sozinho é o que deixa a lacuna: numa rodada acontece, na outra
	 * não. Aqui a assinatura é REPETIDA até cair no caso desejado, o que torna
	 * a cobertura determinística.
	 */
	it('corta o byte de sinal quando r tem o bit alto ligado', async () => {
		const { cert, privada } = await certEc('P-256');
		const attrs = signedAttrs();
		const dados = derBytes(attrs) as BufferSource;

		let sig: Uint8Array | null = null;
		for (let i = 0; i < 60 && !sig; i++) {
			const s = new Uint8Array(
				await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privada, dados)
			);
			if (s[0] & 0x80) sig = s; // r vai ganhar o 0x00 de sinal no DER
		}
		expect(sig, 'não saiu assinatura com bit alto em r em 60 tentativas').not.toBeNull();

		const ok = await verificarAssinaturaCms({
			cert,
			sigAlgOid: SIGNATURE_OIDS.ECDSA_SHA256,
			signedAttrsAsSet: attrs,
			signatureValue: p1363ParaDer(sig!)
		});
		expect(ok).toBe(true);
	});

	/**
	 * O caso do pad usa P-521 de propósito. Ali a coordenada ocupa 66 bytes para
	 * um número de 521 bits, então o primeiro byte é zero em cerca de METADE das
	 * assinaturas — o DER o omite e o código precisa repô-lo. Em P-256 o mesmo
	 * caso é ~1/256, e um laço dimensionado para ele erraria de vez em quando:
	 * teste que falha 10% das vezes não prende nada, só gasta confiança.
	 */
	it('repõe o pad à esquerda quando r vem curto no DER (P-521)', async () => {
		const { cert, privada } = await certEc('P-521');
		const attrs = signedAttrs();
		const dados = derBytes(attrs) as BufferSource;

		let sig: Uint8Array | null = null;
		for (let i = 0; i < 40 && !sig; i++) {
			const s = new Uint8Array(
				await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-512' }, privada, dados)
			);
			if (s[0] === 0) sig = s; // r menor que a largura da curva
		}
		expect(sig, 'não saiu assinatura com r curto em 40 tentativas').not.toBeNull();

		const ok = await verificarAssinaturaCms({
			cert,
			sigAlgOid: SIGNATURE_OIDS.ECDSA_SHA512,
			signedAttrsAsSet: attrs,
			signatureValue: p1363ParaDer(sig!)
		});
		expect(ok).toBe(true);
	});

	/** SPKI sem OID de curva reconhecível: recusa, sem estourar. */
	it('curva desconhecida no certificado é recusada sem lançar', async () => {
		const { cert } = await certEc('P-256');
		// Troca o OID da curva por um inexistente, preservando a estrutura.
		const tbs = (cert as unknown as { tbsCertificate: forge.asn1.Asn1 }).tbsCertificate;
		const spki = (tbs.value as forge.asn1.Asn1[])[6];
		const algSeq = (spki.value as forge.asn1.Asn1[])[0];
		(algSeq.value as forge.asn1.Asn1[])[1].value = forge.asn1
			.oidToDer('1.2.3.4.5.6.7.8')
			.getBytes();

		const ok = await verificarAssinaturaCms({
			cert,
			sigAlgOid: SIGNATURE_OIDS.ECDSA_SHA256,
			signedAttrsAsSet: signedAttrs(),
			signatureValue: '\x30\x06\x02\x01\x01\x02\x01\x01'
		});
		expect(ok).toBe(false);
	});
});
