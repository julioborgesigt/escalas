/**
 * Verificação multi-algoritmo de assinaturas de CMS PKCS#7.
 *
 * O `pdf-verification.ts` original só suportava `sha256WithRSAEncryption`
 * (PKCS#1 v1.5 + SHA-256), fazendo cast direto para `forge.pki.rsa.PublicKey`.
 * Certificados ICP-Brasil modernos podem usar:
 *
 *   - **RSASSA-PSS** (OID 1.2.840.113549.1.1.10) — mais seguro que PKCS#1 v1.5
 *   - **ECDSA** com P-256/P-384/P-521 (OIDs 1.2.840.10045.4.3.{2,3,4})
 *
 * Tokens A3 emitidos a partir de ~2023 com renovação opcional para chave
 * ECDSA NÃO eram verificáveis pelo código antigo (crash silencioso ou
 * `verify` retornando `false`).
 *
 * Estratégia:
 *   - RSA PKCS#1 v1.5 — forge (compatível com Cloudflare Workers, sem await)
 *   - RSA-PSS — Web Crypto API (`crypto.subtle.verify`) — async
 *   - ECDSA — Web Crypto, com conversão de signature ASN.1 → IEEE P1363
 *
 * Toda a interface é async para uniformizar.
 */

import forge from 'node-forge';
import { logger } from './logger';

// OIDs de algoritmos de assinatura (encontrados em SignerInfo.signatureAlgorithm).
// rsaEncryption "puro": não embute o digest — o hash vem do digestAlgorithm do
// SignerInfo. Vários assinadores ICP-Brasil (e o Assinador SERPRO) podem emitir
// o SignerInfo com este OID em vez do combinado sha256WithRSAEncryption.
const OID_RSA_ENCRYPTION = '1.2.840.113549.1.1.1';
const OID_SHA1_RSA = '1.2.840.113549.1.1.5';
const OID_SHA256_RSA = '1.2.840.113549.1.1.11';
const OID_SHA384_RSA = '1.2.840.113549.1.1.12';
const OID_SHA512_RSA = '1.2.840.113549.1.1.13';
const OID_RSA_PSS = '1.2.840.113549.1.1.10';
const OID_ECDSA_SHA256 = '1.2.840.10045.4.3.2';
const OID_ECDSA_SHA384 = '1.2.840.10045.4.3.3';
const OID_ECDSA_SHA512 = '1.2.840.10045.4.3.4';

// OIDs de digest puros (encontrados em SignedAttributes.messageDigest).
const OID_SHA1 = '1.3.14.3.2.26';
const OID_SHA256 = '2.16.840.1.101.3.4.2.1';
const OID_SHA384 = '2.16.840.1.101.3.4.2.2';
const OID_SHA512 = '2.16.840.1.101.3.4.2.3';

// Identificador da família de curva ECDSA (subjectPublicKeyInfo.algorithm.parameters).
const OID_EC_PUBLIC_KEY = '1.2.840.10045.2.1';
const OID_PRIME256V1 = '1.2.840.10045.3.1.7'; // P-256
const OID_SECP384R1 = '1.3.132.0.34'; // P-384
const OID_SECP521R1 = '1.3.132.0.35'; // P-521

export type SignatureFamily = 'rsa-pkcs1' | 'rsa-pss' | 'ecdsa';

export interface VerifyParams {
	/** Certificado do signatário (forge). */
	cert: forge.pki.Certificate;
	/** OID do signatureAlgorithm do SignerInfo. */
	sigAlgOid: string;
	/** SignedAttributes ASN.1 já reencodado como SET (tag 0x31). */
	signedAttrsAsSet: forge.asn1.Asn1;
	/** Bytes brutos do signatureValue (string binária). */
	signatureValue: string;
	/**
	 * OID do `digestAlgorithm` do SignerInfo. Necessário apenas quando
	 * `sigAlgOid` é `rsaEncryption` (1.1.1), que não embute o digest no OID.
	 */
	digestAlgOid?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function binStringToUint8(s: string): Uint8Array {
	const out = new Uint8Array(s.length);
	for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
	return out;
}

function uint8ToArrayBuffer(u: Uint8Array): ArrayBuffer {
	return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
}

/** Devolve o tamanho do digest associado ao OID do signatureAlgorithm. */
function digestFromSigAlg(sigAlgOid: string): 'SHA-1' | 'SHA-256' | 'SHA-384' | 'SHA-512' | null {
	switch (sigAlgOid) {
		case OID_SHA1_RSA:
			return 'SHA-1';
		case OID_SHA256_RSA:
		case OID_ECDSA_SHA256:
		case OID_RSA_PSS: // PSS default na ICP-Brasil é SHA-256 (DOC-ICP-15.03)
			return 'SHA-256';
		case OID_SHA384_RSA:
		case OID_ECDSA_SHA384:
			return 'SHA-384';
		case OID_SHA512_RSA:
		case OID_ECDSA_SHA512:
			return 'SHA-512';
		default:
			return null;
	}
}

/**
 * Mapeia o OID do `digestAlgorithm` (digest puro, sem RSA) para o nome
 * Web Crypto. Usado quando o `signatureAlgorithm` é `rsaEncryption` (1.1.1).
 */
function digestFromDigestOid(
	oid: string | undefined
): 'SHA-1' | 'SHA-256' | 'SHA-384' | 'SHA-512' | null {
	switch (oid) {
		case OID_SHA1:
			return 'SHA-1';
		case OID_SHA256:
			return 'SHA-256';
		case OID_SHA384:
			return 'SHA-384';
		case OID_SHA512:
			return 'SHA-512';
		default:
			return null;
	}
}

function familyFromSigAlg(sigAlgOid: string): SignatureFamily | null {
	if (
		sigAlgOid === OID_RSA_ENCRYPTION ||
		sigAlgOid === OID_SHA1_RSA ||
		sigAlgOid === OID_SHA256_RSA ||
		sigAlgOid === OID_SHA384_RSA ||
		sigAlgOid === OID_SHA512_RSA
	) {
		return 'rsa-pkcs1';
	}
	if (sigAlgOid === OID_RSA_PSS) return 'rsa-pss';
	if (
		sigAlgOid === OID_ECDSA_SHA256 ||
		sigAlgOid === OID_ECDSA_SHA384 ||
		sigAlgOid === OID_ECDSA_SHA512
	) {
		return 'ecdsa';
	}
	return null;
}

/**
 * Devolve o curve name Web Crypto para a chave EC do certificado.
 * Extraído do parameter OID em SubjectPublicKeyInfo.
 */
function ecCurveFromSpki(spki: forge.asn1.Asn1): 'P-256' | 'P-384' | 'P-521' | null {
	try {
		const algorithmSeq = (spki.value as forge.asn1.Asn1[])[0];
		const paramsOidBytes = (algorithmSeq.value as forge.asn1.Asn1[])[1].value as string;
		const oid = forge.asn1.derToOid(paramsOidBytes);
		if (oid === OID_PRIME256V1) return 'P-256';
		if (oid === OID_SECP384R1) return 'P-384';
		if (oid === OID_SECP521R1) return 'P-521';
		logger.warn('[CRYPTO-VERIFY] Curva EC desconhecida', { oid });
		return null;
	} catch {
		return null;
	}
}

/**
 * Converte signature ECDSA do formato ASN.1 (SEQUENCE { INTEGER r, INTEGER s })
 * para o formato IEEE P1363 (r||s) que Web Crypto espera.
 *
 * O comprimento de r e s deve ser igual ao tamanho da coordenada da curva
 * (32 bytes para P-256, 48 para P-384, 66 para P-521). INTEGERs em DER podem
 * vir com byte 0x00 de padding (positivo) ou menores que o esperado — nós
 * normalizamos para o tamanho exato.
 */
function ecdsaAsn1ToP1363(signatureValue: string, coordLen: number): Uint8Array {
	const asn1 = forge.asn1.fromDer(signatureValue);
	const [rAsn1, sAsn1] = asn1.value as forge.asn1.Asn1[];
	const rBytes = binStringToUint8(rAsn1.value as string);
	const sBytes = binStringToUint8(sAsn1.value as string);

	const r = new Uint8Array(coordLen);
	const s = new Uint8Array(coordLen);
	// Strip leading 0x00 (sign byte de positivo) ou pad à esquerda com 0.
	const rTrim = rBytes[0] === 0 && rBytes.length === coordLen + 1 ? rBytes.slice(1) : rBytes;
	const sTrim = sBytes[0] === 0 && sBytes.length === coordLen + 1 ? sBytes.slice(1) : sBytes;
	r.set(rTrim, coordLen - rTrim.length);
	s.set(sTrim, coordLen - sTrim.length);

	const out = new Uint8Array(coordLen * 2);
	out.set(r, 0);
	out.set(s, coordLen);
	return out;
}

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------

/**
 * Verifica a assinatura do SignerInfo (sobre os SignedAttributes) com
 * suporte a RSA PKCS#1 v1.5, RSA-PSS e ECDSA.
 *
 * Falha-silenciosa: nunca lança; em qualquer erro devolve `false`.
 */
export async function verificarAssinaturaCms(params: VerifyParams): Promise<boolean> {
	const family = familyFromSigAlg(params.sigAlgOid);
	// Para `rsaEncryption` puro (1.1.1) o OID não embute o digest — derivamos do
	// `digestAlgorithm` do SignerInfo. Para os OIDs combinados, o digest vem do
	// próprio sigAlgOid.
	const hash =
		digestFromSigAlg(params.sigAlgOid) ??
		(params.sigAlgOid === OID_RSA_ENCRYPTION ? digestFromDigestOid(params.digestAlgOid) : null);
	if (!family || !hash) {
		logger.warn('[CRYPTO-VERIFY] OID de signatureAlgorithm não suportado', {
			oid: params.sigAlgOid,
			digestOid: params.digestAlgOid
		});
		return false;
	}

	const signedAttrsDer = forge.asn1.toDer(params.signedAttrsAsSet).getBytes();

	try {
		if (family === 'rsa-pkcs1') {
			// Caminho legado via forge — sem await, funciona em qualquer runtime.
			const md = digestFactory(hash);
			md.update(signedAttrsDer);
			const pubKey = params.cert.publicKey as forge.pki.rsa.PublicKey;
			return pubKey.verify(md.digest().getBytes(), params.signatureValue);
		}

		if (family === 'rsa-pss') {
			// Web Crypto: exporta SPKI, importa como RSA-PSS, verifica.
			const spki = forge.pki.publicKeyToAsn1(params.cert.publicKey);
			const spkiDer = forge.asn1.toDer(spki).getBytes();
			const keyBuf = uint8ToArrayBuffer(binStringToUint8(spkiDer));
			const dataBuf = uint8ToArrayBuffer(binStringToUint8(signedAttrsDer));
			const sigBuf = uint8ToArrayBuffer(binStringToUint8(params.signatureValue));

			const key = await crypto.subtle.importKey(
				'spki',
				keyBuf,
				{ name: 'RSA-PSS', hash: { name: hash } },
				false,
				['verify']
			);
			return crypto.subtle.verify(
				// DOC-ICP-15.03: saltLength == digest length (default Brasileiro).
				{ name: 'RSA-PSS', saltLength: hashByteLen(hash) },
				key,
				sigBuf,
				dataBuf
			);
		}

		if (family === 'ecdsa') {
			// SPKI vem direto do node-forge para ECPublicKey.
			// Como forge não tem `publicKeyToAsn1` para EC, pegamos o SPKI bruto
			// do cert (subjectPublicKeyInfo).
			const certAsn1 = forge.pki.certificateToAsn1(params.cert);
			const tbs = (certAsn1.value as forge.asn1.Asn1[])[0];
			// tbs.children: version, serial, sigAlg, issuer, validity, subject, spki, ...
			const spki = (tbs.value as forge.asn1.Asn1[])[6];

			const curve = ecCurveFromSpki(spki);
			if (!curve) {
				logger.warn('[CRYPTO-VERIFY] Curva ECDSA não identificada');
				return false;
			}
			const coordLen = curve === 'P-256' ? 32 : curve === 'P-384' ? 48 : 66;

			const spkiDer = forge.asn1.toDer(spki).getBytes();
			const keyBuf = uint8ToArrayBuffer(binStringToUint8(spkiDer));
			const dataBuf = uint8ToArrayBuffer(binStringToUint8(signedAttrsDer));
			const sigP1363 = ecdsaAsn1ToP1363(params.signatureValue, coordLen);
			const sigBuf = uint8ToArrayBuffer(sigP1363);

			const key = await crypto.subtle.importKey(
				'spki',
				keyBuf,
				{ name: 'ECDSA', namedCurve: curve },
				false,
				['verify']
			);
			return crypto.subtle.verify({ name: 'ECDSA', hash: { name: hash } }, key, sigBuf, dataBuf);
		}

		return false;
	} catch (e) {
		logger.warn('[CRYPTO-VERIFY] Falha na verificação', {
			family,
			hash,
			error: e instanceof Error ? e.message : String(e)
		});
		return false;
	}
}

function digestFactory(hash: 'SHA-1' | 'SHA-256' | 'SHA-384' | 'SHA-512'): forge.md.MessageDigest {
	switch (hash) {
		case 'SHA-1':
			return forge.md.sha1.create();
		case 'SHA-256':
			return forge.md.sha256.create();
		case 'SHA-384':
			return forge.md.sha384.create();
		case 'SHA-512':
			return forge.md.sha512.create();
	}
}

function hashByteLen(hash: 'SHA-1' | 'SHA-256' | 'SHA-384' | 'SHA-512'): number {
	switch (hash) {
		case 'SHA-1':
			return 20;
		case 'SHA-256':
			return 32;
		case 'SHA-384':
			return 48;
		case 'SHA-512':
			return 64;
	}
}

// Re-exporta OIDs caso o caller queira referenciar (sem importar a constante interna).
export const SIGNATURE_OIDS = {
	RSA_ENCRYPTION: OID_RSA_ENCRYPTION,
	SHA1_RSA: OID_SHA1_RSA,
	SHA256_RSA: OID_SHA256_RSA,
	SHA384_RSA: OID_SHA384_RSA,
	SHA512_RSA: OID_SHA512_RSA,
	RSA_PSS: OID_RSA_PSS,
	ECDSA_SHA256: OID_ECDSA_SHA256,
	ECDSA_SHA384: OID_ECDSA_SHA384,
	ECDSA_SHA512: OID_ECDSA_SHA512
} as const;

export const DIGEST_OIDS = {
	SHA1: OID_SHA1,
	SHA256: OID_SHA256,
	SHA384: OID_SHA384,
	SHA512: OID_SHA512
} as const;
