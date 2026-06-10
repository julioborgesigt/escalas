/**
 * Cliente OCSP mínimo (RFC 6960) compatível com Cloudflare Workers.
 *
 * Implementação direta em node-forge (sem libs nativas) para construir o
 * `OCSPRequest` em DER e parsear o `OCSPResponse` retornado pelo responder.
 *
 * Escopo: o suficiente para validar cadeia CAdES-LT — extrair status do
 * certificado (`good` / `revoked` / `unknown`) e armazenar a resposta DER
 * carimbada para reauditoria offline.
 */

import forge from 'node-forge';
import { logger } from './logger';

const OID_OCSP_AIA = '1.3.6.1.5.5.7.48.1';
const OID_OCSP_NONCE = '1.3.6.1.5.5.7.48.1.2';
const OID_SHA1 = '1.3.14.3.2.26';

export type StatusOcsp = 'good' | 'revoked' | 'unknown';

export interface OcspSnapshot {
	status: StatusOcsp;
	/** Resposta OCSP completa em DER base64 — armazenada para auditoria CAdES-LT. */
	responseDerB64: string;
	/** URL do responder consultado. */
	url: string;
	/** ISO 8601 do momento da consulta. */
	consultadoEm: string;
	/** Data de revogação se status === 'revoked'. */
	revokedAt?: string;
	/** Motivo de erro se a consulta falhou (status === 'unknown'). */
	erro?: string;
	/**
	 * Resultado da validação da assinatura do BasicOCSPResponse contra a
	 * chave pública do responder:
	 *   - `'valida'`: assinatura matemática conferida + responder confiável
	 *     (cert do responder vem na resposta e é assinado pelo issuer,
	 *      OU o responder é o próprio issuer)
	 *   - `'invalida'`: matemática falhou OU responder não confiável
	 *   - `'nao_verificada'`: snapshot antigo (pré-feature) ou sem issuer
	 *      disponível para a checagem offline.
	 *
	 * **Importante**: snapshots com `assinaturaResponder='invalida'` NÃO devem
	 * ser confiados. O caller (`cades-finalizer`) trata isso como falha 422.
	 */
	assinaturaResponder?: 'valida' | 'invalida' | 'nao_verificada';
	/** Eco do nonce recebido (se o responder suportou). */
	nonceEcoadoOk?: boolean;
}

/**
 * Extrai a URL do responder OCSP da extensão AuthorityInfoAccess do certificado.
 * Retorna `null` se a extensão não estiver presente.
 */
export function extrairUrlOcsp(cert: forge.pki.Certificate): string | null {
	const ext = cert.getExtension('authorityInfoAccess') as
		| { value: string; id?: string }
		| null
		| undefined;
	if (!ext || !ext.value) return null;

	try {
		const asn1 = forge.asn1.fromDer(ext.value);
		// AuthorityInfoAccessSyntax  ::=  SEQUENCE OF AccessDescription
		const lista = asn1.value as forge.asn1.Asn1[];
		for (const access of lista) {
			const filhos = access.value as forge.asn1.Asn1[];
			if (filhos.length < 2) continue;
			const oidBytes = filhos[0].value as string;
			const oid = forge.asn1.derToOid(oidBytes);
			if (oid !== OID_OCSP_AIA) continue;
			// accessLocation pode vir como [6] IMPLICIT IA5String (uniformResourceIdentifier)
			const loc = filhos[1];
			const url =
				typeof loc.value === 'string'
					? loc.value
					: forge.util.bytesToHex(loc.value as unknown as string);
			if (typeof url === 'string' && url.startsWith('http')) {
				return url;
			}
		}
	} catch (e) {
		logger.warn('[OCSP] Falha ao parsear AIA', {
			error: e instanceof Error ? e.message : String(e)
		});
	}
	return null;
}

/**
 * Interpreta `host` como IPv4 em QUALQUER forma aceita por `inet_aton`:
 * decimal pontilhado, octal (017700000001), hex (0x7f.0.0.1), inteiro único
 * (2130706433) e formas com 2/3 partes. Retorna o valor de 32 bits ou `null`
 * quando não é um literal IPv4. Sem isso, encodings alternativos contornariam
 * a checagem de faixas (o fetch do Node/undici resolve todos para o mesmo IP).
 */
function parseIpv4Literal(host: string): number | null {
	if (!/^[0-9a-fA-FxX.]+$/.test(host) || host.length === 0) return null;
	let parts = host.split('.');
	// Trailing dot ("127.0.0.1.") é tolerado por alguns resolvers.
	if (parts.length > 1 && parts[parts.length - 1] === '') parts = parts.slice(0, -1);
	if (parts.length < 1 || parts.length > 4) return null;
	const nums: number[] = [];
	for (const p of parts) {
		let v: number;
		if (/^0[xX][0-9a-fA-F]+$/.test(p)) v = parseInt(p.slice(2), 16);
		else if (/^0[0-7]*$/.test(p)) v = parseInt(p, 8);
		else if (/^[1-9][0-9]*$/.test(p)) v = parseInt(p, 10);
		else return null;
		if (!Number.isFinite(v) || v < 0) return null;
		nums.push(v);
	}
	// Semântica inet_aton: as n-1 primeiras partes são octetos; a última
	// preenche os bytes restantes.
	const n = nums.length;
	for (let i = 0; i < n - 1; i++) if (nums[i] > 255) return null;
	const bytesUltimo = 4 - (n - 1);
	if (nums[n - 1] > 2 ** (8 * bytesUltimo) - 1) return null;
	let val = 0;
	for (let i = 0; i < n - 1; i++) val = val * 256 + nums[i];
	return (val * 2 ** (8 * bytesUltimo) + nums[n - 1]) >>> 0;
}

/** Faixas IPv4 proibidas (loopback, privadas, link-local, CGNAT, reservadas). */
function ipv4Bloqueado(ip: number): boolean {
	const a = (ip >>> 24) & 0xff;
	const b = (ip >>> 16) & 0xff;
	if (a === 0 || a === 10 || a === 127) return true; // this-net, 10/8, loopback
	if (a === 169 && b === 254) return true; // link-local + metadados de nuvem
	if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
	if (a === 192 && b === 168) return true; // 192.168/16
	if (a === 192 && b === 0) return true; // 192.0.0/24 (IETF) + 192.0.2/24 (TEST-NET-1)
	if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking 198.18/15
	if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
	if (a >= 224) return true; // multicast/reservado/broadcast
	return false;
}

/**
 * Expande um literal IPv6 para 8 grupos de 16 bits. Aceita `::` e IPv4
 * embutido na cauda (`::ffff:127.0.0.1`). Retorna `null` se malformado.
 */
function parseIpv6Literal(host: string): number[] | null {
	if (!host.includes(':')) return null;
	// Zone index (fe80::1%eth0) — descarta para análise.
	const semZona = host.split('%')[0];
	const dupla = semZona.split('::');
	if (dupla.length > 2) return null;
	const parseLado = (lado: string): number[] | null => {
		if (lado === '') return [];
		const grupos: number[] = [];
		const partes = lado.split(':');
		for (let i = 0; i < partes.length; i++) {
			const p = partes[i];
			if (i === partes.length - 1 && p.includes('.')) {
				const v4 = parseIpv4Literal(p);
				if (v4 === null) return null;
				grupos.push((v4 >>> 16) & 0xffff, v4 & 0xffff);
			} else if (/^[0-9a-fA-F]{1,4}$/.test(p)) {
				grupos.push(parseInt(p, 16));
			} else {
				return null;
			}
		}
		return grupos;
	};
	const esq = parseLado(dupla[0]);
	if (esq === null) return null;
	if (dupla.length === 1) {
		return esq.length === 8 ? esq : null;
	}
	const dir = parseLado(dupla[1]);
	if (dir === null || esq.length + dir.length > 7) return null;
	return [...esq, ...new Array(8 - esq.length - dir.length).fill(0), ...dir];
}

/** Faixas IPv6 proibidas, incluindo IPv4 embutido (mapped/compatible/NAT64). */
function ipv6Bloqueado(grupos: number[]): boolean {
	const todosZero = (ate: number) => grupos.slice(0, ate).every((g) => g === 0);
	// :: (unspecified) e ::1 (loopback)
	if (todosZero(7) && (grupos[7] === 0 || grupos[7] === 1)) return true;
	// IPv4-mapped (::ffff:0:0/96), IPv4-compatible (::/96) e NAT64 (64:ff9b::/96):
	// aplica as faixas IPv4 ao endereço embutido.
	const v4Embutido =
		(todosZero(5) && (grupos[5] === 0xffff || grupos[5] === 0)) ||
		(grupos[0] === 0x64 && grupos[1] === 0xff9b && grupos.slice(2, 6).every((g) => g === 0));
	if (v4Embutido) {
		const ip4 = ((grupos[6] << 16) | grupos[7]) >>> 0;
		if (ipv4Bloqueado(ip4)) return true;
	}
	const alto = grupos[0];
	if ((alto & 0xffc0) === 0xfe80) return true; // link-local fe80::/10
	if ((alto & 0xffc0) === 0xfec0) return true; // site-local (deprecated) fec0::/10
	if ((alto & 0xfe00) === 0xfc00) return true; // ULA fc00::/7
	return false;
}

/**
 * Defesa SSRF: a URL do responder OCSP vem da extensão AIA do certificado
 * enviado pelo USUÁRIO. Sem validação, um cert com AIA apontando para um host
 * interno faria o servidor emitir um POST para lá. Permitimos apenas http(s)
 * para hosts públicos — bloqueamos loopback, redes privadas (RFC 1918), CGNAT,
 * link-local e o endpoint de metadados de nuvem (169.254.169.254), em TODOS
 * os encodings de IP (decimal/octal/hex/inteiro, IPv6 e IPv4 embutido em IPv6).
 *
 * Validação por literal de host (defesa em camadas; não cobre DNS-rebinding,
 * mas o runtime Cloudflare Workers não expõe serviços locais/metadados como um
 * servidor tradicional). Combinada com a validação de cadeia ICP-Brasil que
 * roda antes da consulta, fecha o vetor na prática.
 */
export function urlOcspPermitida(url: string): boolean {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return false;
	}
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;

	// IPv6 literal vem entre colchetes no `hostname` (ex.: `[::1]`) — remove para análise.
	let host = parsed.hostname.toLowerCase();
	if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
	if (!host) return false;

	// Nomes locais óbvios.
	if (
		host === 'localhost' ||
		host.endsWith('.localhost') ||
		host.endsWith('.local') ||
		host.endsWith('.internal')
	) {
		return false;
	}

	const v6 = parseIpv6Literal(host);
	if (v6) return !ipv6Bloqueado(v6);

	const v4 = parseIpv4Literal(host);
	if (v4 !== null) return !ipv4Bloqueado(v4);

	return true;
}

/**
 * Constrói o CertID (RFC 6960) usando SHA-1 (algoritmo padrão).
 */
function buildCertId(cert: forge.pki.Certificate, issuer: forge.pki.Certificate): forge.asn1.Asn1 {
	// issuerNameHash = SHA-1(DER do subject do issuer)
	const issuerSubjectAsn1 = forge.pki.distinguishedNameToAsn1(issuer.subject);
	const issuerSubjectDer = forge.asn1.toDer(issuerSubjectAsn1).getBytes();
	const md1 = forge.md.sha1.create();
	md1.update(issuerSubjectDer);
	const issuerNameHash = md1.digest().getBytes();

	// issuerKeyHash = SHA-1(BIT STRING value da chave pública do issuer).
	//
	// Em node-forge, `publicKeyToAsn1` retorna um SubjectPublicKeyInfo cujo
	// BIT STRING (último filho) pode vir em DUAS formas:
	//   1. PRIMITIVO  — `value` é string de bytes começando com `\x00`
	//      (octeto "unused bits = 0"), seguido pelos bytes da RSAPublicKey
	//      em DER. Caso típico quando o cert foi parseado a partir de DER.
	//   2. CONSTRUÍDO — `value` é um Array (a RSAPublicKey já parseada).
	//      Caso típico quando o cert foi construído programaticamente.
	//
	// O bug original assumia sempre o caso (1) e crashava com
	// "bitStringBytes.startsWith is not a function" no caso (2). Como
	// `consultarOcsp` engole exceções e retorna `{ status: 'unknown' }`,
	// a falha era silenciosa — o cliente OCSP nunca funcionava para certs
	// construídos in-memory (e degradava silenciosamente p/ outros casos
	// onde a regra `\x00` não se aplicasse).
	const pubKeyAsn1 = forge.pki.publicKeyToAsn1(issuer.publicKey);
	const spki = pubKeyAsn1.value as forge.asn1.Asn1[];
	const bitString = spki[spki.length - 1];
	let keyBytes: string;
	if (typeof bitString.value === 'string') {
		// Primitivo: descarta o primeiro byte (unused bits count).
		keyBytes = bitString.value.startsWith('\x00') ? bitString.value.slice(1) : bitString.value;
	} else {
		// Construído: re-serializa os filhos para obter os bytes do conteúdo.
		const children = bitString.value as forge.asn1.Asn1[];
		keyBytes = children.map((child) => forge.asn1.toDer(child).getBytes()).join('');
	}
	const md2 = forge.md.sha1.create();
	md2.update(keyBytes);
	const issuerKeyHash = md2.digest().getBytes();

	const serialBytes = forge.util.hexToBytes(cert.serialNumber);

	return forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
		// hashAlgorithm: SHA-1
		forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
			forge.asn1.create(
				forge.asn1.Class.UNIVERSAL,
				forge.asn1.Type.OID,
				false,
				forge.asn1.oidToDer(OID_SHA1).getBytes()
			),
			forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.NULL, false, '')
		]),
		// issuerNameHash
		forge.asn1.create(
			forge.asn1.Class.UNIVERSAL,
			forge.asn1.Type.OCTETSTRING,
			false,
			issuerNameHash
		),
		// issuerKeyHash
		forge.asn1.create(
			forge.asn1.Class.UNIVERSAL,
			forge.asn1.Type.OCTETSTRING,
			false,
			issuerKeyHash
		),
		// serialNumber
		forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.INTEGER, false, serialBytes)
	]);
}

/**
 * Constrói um OCSPRequest DER para um único certificado, sem assinatura.
 *
 * Inclui a extensão `id-pkix-ocsp-nonce` (OID 1.3.6.1.5.5.7.48.1.2) com
 * 16 bytes aleatórios — mitiga replay caching pelo responder (RFC 6960 §4.4.1).
 * O nonce gerado é devolvido para o caller comparar com o eco da resposta.
 *
 * Nota: alguns responders OCSP (Microsoft, ITI antigos) ignoram a extensão.
 * Nesses casos a resposta não traz o nonce de volta e tratamos como "sem
 * confirmação de freshness" mas não inválida — é o comportamento da maioria
 * das libs (OpenSSL, Bouncy Castle).
 */
function buildOcspRequestDer(
	cert: forge.pki.Certificate,
	issuer: forge.pki.Certificate
): { requestDer: Uint8Array; nonce: Uint8Array } {
	const certId = buildCertId(cert, issuer);
	const request = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
		certId
	]);
	const requestList = forge.asn1.create(
		forge.asn1.Class.UNIVERSAL,
		forge.asn1.Type.SEQUENCE,
		true,
		[request]
	);

	// Nonce de 16 bytes (RFC 8954 recomenda 1..32 octets).
	const nonce = crypto.getRandomValues(new Uint8Array(16));
	let nonceStr = '';
	for (const b of nonce) nonceStr += String.fromCharCode(b);

	// Extension ::= SEQUENCE { extnID OID, critical BOOLEAN DEFAULT FALSE, extnValue OCTET STRING }
	// extnValue contém um OCTET STRING DER aninhado (que é o valor real da extensão).
	const nonceOctet = forge.asn1.create(
		forge.asn1.Class.UNIVERSAL,
		forge.asn1.Type.OCTETSTRING,
		false,
		nonceStr
	);
	const nonceOctetDer = forge.asn1.toDer(nonceOctet).getBytes();
	const nonceExt = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
		forge.asn1.create(
			forge.asn1.Class.UNIVERSAL,
			forge.asn1.Type.OID,
			false,
			forge.asn1.oidToDer(OID_OCSP_NONCE).getBytes()
		),
		forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.OCTETSTRING, false, nonceOctetDer)
	]);
	const extensions = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
		nonceExt
	]);
	// [2] EXPLICIT requestExtensions
	const requestExtensionsWrap = forge.asn1.create(forge.asn1.Class.CONTEXT_SPECIFIC, 2, true, [
		extensions
	]);

	const tbsRequest = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
		requestList,
		requestExtensionsWrap
	]);
	const ocspRequest = forge.asn1.create(
		forge.asn1.Class.UNIVERSAL,
		forge.asn1.Type.SEQUENCE,
		true,
		[tbsRequest]
	);
	const der = forge.asn1.toDer(ocspRequest).getBytes();

	const bytes = new Uint8Array(der.length);
	for (let i = 0; i < der.length; i++) bytes[i] = der.charCodeAt(i) & 0xff;
	return { requestDer: bytes, nonce };
}

// ---------------------------------------------------------------------------
// Validação da assinatura do BasicOCSPResponse (RFC 6960 §4.2.2.2)
// ---------------------------------------------------------------------------

/**
 * Extrai os componentes do `BasicOCSPResponse` necessários para validar a
 * assinatura matemática e a confiabilidade do responder.
 *
 * BasicOCSPResponse ::= SEQUENCE {
 *     tbsResponseData      ResponseData,
 *     signatureAlgorithm   AlgorithmIdentifier,
 *     signature            BIT STRING,
 *     certs            [0] EXPLICIT SEQUENCE OF Certificate OPTIONAL
 * }
 */
function extrairComponentesBasic(basicAsn1: forge.asn1.Asn1): {
	tbsResponseDataDer: string;
	signatureValue: string;
	sigAlgOid: string;
	responderCerts: forge.pki.Certificate[];
	responseExtensions: forge.asn1.Asn1[] | null;
} | null {
	try {
		const children = basicAsn1.value as forge.asn1.Asn1[];
		const tbs = children[0];
		const sigAlg = children[1];
		const sig = children[2];

		const tbsDer = forge.asn1.toDer(tbs).getBytes();
		const sigAlgOidBytes = (sigAlg.value as forge.asn1.Asn1[])[0].value as string;
		const sigAlgOid = forge.asn1.derToOid(sigAlgOidBytes);

		// BIT STRING: o primeiro byte é "unused bits count" (geralmente 0).
		let signatureValue = sig.value as string;
		if (signatureValue.startsWith('\x00')) signatureValue = signatureValue.slice(1);

		const responderCerts: forge.pki.Certificate[] = [];
		for (const f of children.slice(3)) {
			if (f.tagClass === forge.asn1.Class.CONTEXT_SPECIFIC && (f.type as number) === 0) {
				// [0] EXPLICIT SEQUENCE OF Certificate
				for (const certAsn1 of f.value as forge.asn1.Asn1[]) {
					try {
						responderCerts.push(forge.pki.certificateFromAsn1(certAsn1));
					} catch {
						/* cert malformado — ignora */
					}
				}
			}
		}

		// Extensões da resposta (procuramos o nonce em responseExtensions).
		let responseExtensions: forge.asn1.Asn1[] | null = null;
		const tbsChildren = tbs.value as forge.asn1.Asn1[];
		for (const f of tbsChildren) {
			if (f.tagClass === forge.asn1.Class.CONTEXT_SPECIFIC && (f.type as number) === 1) {
				responseExtensions = (f.value as forge.asn1.Asn1[])[0].value as forge.asn1.Asn1[];
				break;
			}
		}

		return {
			tbsResponseDataDer: tbsDer,
			signatureValue,
			sigAlgOid,
			responderCerts,
			responseExtensions
		};
	} catch (e) {
		logger.warn('[OCSP] Falha ao extrair componentes do BasicOCSPResponse', {
			error: e instanceof Error ? e.message : String(e)
		});
		return null;
	}
}

/**
 * OIDs de algoritmo de assinatura comuns em respostas OCSP da ICP-Brasil.
 * Mapeia para o digest algorithm do `forge.md`.
 */
const SIG_ALG_DIGEST: Record<string, () => forge.md.MessageDigest> = {
	'1.2.840.113549.1.1.5': forge.md.sha1.create, // sha1WithRSAEncryption
	'1.2.840.113549.1.1.11': forge.md.sha256.create, // sha256WithRSAEncryption
	'1.2.840.113549.1.1.12': forge.md.sha384.create, // sha384WithRSAEncryption
	'1.2.840.113549.1.1.13': forge.md.sha512.create // sha512WithRSAEncryption
};

/**
 * Verifica a assinatura matemática do `BasicOCSPResponse` contra a chave
 * pública do responder, e checa que o responder é confiável:
 *
 *   1. Responder é o próprio issuer do cert consultado (caso comum em ACs
 *      ICP-Brasil), OU
 *   2. Responder é um "delegate" cujo certificado está em `responderCerts`,
 *      foi emitido pelo issuer, e tem o EKU `id-kp-OCSPSigning` (RFC 6960
 *      §4.2.2.2 b).
 *
 * Retorna `'valida' | 'invalida'` sempre — `'nao_verificada'` é decisão
 * do caller quando não temos issuer disponível.
 */
function verificarSignatureBasic(
	basicAsn1: forge.asn1.Asn1,
	issuer: forge.pki.Certificate
): 'valida' | 'invalida' {
	const comp = extrairComponentesBasic(basicAsn1);
	if (!comp) return 'invalida';

	// Selecionar a chave pública do responder.
	const responderEhDelegate = comp.responderCerts.length > 0;
	const responderCert: forge.pki.Certificate = responderEhDelegate
		? comp.responderCerts[0]
		: issuer;

	// 1. Validar matemática RSA (suporte só a RSA por enquanto;
	//    ECDSA em responders OCSP é raro mas existe — TODO).
	const mdFactory = SIG_ALG_DIGEST[comp.sigAlgOid];
	if (!mdFactory) {
		logger.warn('[OCSP] Algoritmo de assinatura do responder não suportado', {
			oid: comp.sigAlgOid
		});
		return 'invalida';
	}

	try {
		const md = mdFactory();
		md.update(comp.tbsResponseDataDer);
		const pubKey = responderCert.publicKey as forge.pki.rsa.PublicKey;
		const ok = pubKey.verify(md.digest().getBytes(), comp.signatureValue);
		if (!ok) {
			logger.info('[OCSP] Assinatura do responder NÃO confere matematicamente');
			return 'invalida';
		}
	} catch (e) {
		logger.warn('[OCSP] Erro na verificação RSA do responder', {
			error: e instanceof Error ? e.message : String(e)
		});
		return 'invalida';
	}

	// 2. Confirmar confiança no responder.
	if (!responderEhDelegate) {
		// Já é o issuer — confiável por construção.
		return 'valida';
	}

	// É delegate: cert do responder deve ter sido emitido PELO issuer.
	try {
		const issuerCaStore = forge.pki.createCaStore([issuer]);
		const cadeiaOk = forge.pki.verifyCertificateChain(issuerCaStore, [responderCert]);
		if (!cadeiaOk) return 'invalida';
	} catch {
		return 'invalida';
	}

	// E ter o EKU id-kp-OCSPSigning (RFC 6960 §4.2.2.2 b).
	const eku = responderCert.getExtension('extKeyUsage') as
		| { serverAuth?: boolean; OCSPSigning?: boolean }
		| null
		| undefined;
	if (!eku?.OCSPSigning) {
		logger.info('[OCSP] Cert responder delegate sem EKU id-kp-OCSPSigning');
		return 'invalida';
	}

	return 'valida';
}

/**
 * Verifica o eco do nonce na resposta OCSP. Retorna `true` quando o nonce
 * está presente e bate; `false` quando está presente e diverge (alerta);
 * `null` quando ausente (responder não suportou — aceitável).
 */
function verificarNonceEco(
	responseExtensions: forge.asn1.Asn1[] | null,
	nonceEsperado: Uint8Array
): boolean | null {
	if (!responseExtensions) return null;
	for (const ext of responseExtensions) {
		const filhos = ext.value as forge.asn1.Asn1[];
		const oidBytes = filhos[0].value as string;
		if (forge.asn1.derToOid(oidBytes) !== OID_OCSP_NONCE) continue;

		// extnValue é OCTET STRING contendo outro OCTET STRING DER aninhado.
		const wrapper = filhos[filhos.length - 1].value as string;
		try {
			const innerAsn1 = forge.asn1.fromDer(wrapper);
			const recebido = innerAsn1.value as string;
			if (recebido.length !== nonceEsperado.length) return false;
			for (let i = 0; i < nonceEsperado.length; i++) {
				if (recebido.charCodeAt(i) !== nonceEsperado[i]) return false;
			}
			return true;
		} catch {
			return false;
		}
	}
	return null; // ausente
}

/**
 * Parseia minimamente o OCSPResponse e extrai o status do certificado.
 *
 * OCSPResponse ::= SEQUENCE {
 *     responseStatus  OCSPResponseStatus (ENUMERATED),
 *     responseBytes   [0] EXPLICIT ResponseBytes OPTIONAL }
 *
 * ResponseBytes ::= SEQUENCE { responseType OID, response OCTET STRING }
 *
 * BasicOCSPResponse ::= SEQUENCE { tbsResponseData ResponseData, ... }
 * ResponseData ::= SEQUENCE { ..., responses SEQUENCE OF SingleResponse, ... }
 * SingleResponse ::= SEQUENCE { certID, certStatus, thisUpdate, ... }
 *
 * certStatus ::= CHOICE {
 *     good        [0] IMPLICIT NULL,
 *     revoked     [1] IMPLICIT RevokedInfo,
 *     unknown     [2] IMPLICIT UnknownInfo }
 */
function parseOcspStatus(responseDer: Uint8Array): {
	status: StatusOcsp;
	revokedAt?: string;
	/** BasicOCSPResponse parseado, para o caller validar signature. */
	basicAsn1?: forge.asn1.Asn1;
} {
	try {
		const buffer = forge.util.createBuffer(String.fromCharCode(...Array.from(responseDer)));
		const asn1 = forge.asn1.fromDer(buffer);
		const top = asn1.value as forge.asn1.Asn1[];
		// top[0] = responseStatus (ENUMERATED) — 0 = successful
		const responseStatusBytes = top[0].value as string;
		if (responseStatusBytes.charCodeAt(0) !== 0) {
			return { status: 'unknown' };
		}
		// top[1] = [0] EXPLICIT ResponseBytes
		const responseBytesWrap = top[1];
		const responseBytes = (responseBytesWrap.value as forge.asn1.Asn1[])[0];
		const responseInner = (responseBytes.value as forge.asn1.Asn1[])[1];
		// responseInner is an OCTET STRING containing BasicOCSPResponse DER
		const basicDer = responseInner.value as string;
		const basic = forge.asn1.fromDer(basicDer);
		const basicAsn1 = basic; // capturado para o caller validar signature
		const tbsResponseData = (basic.value as forge.asn1.Asn1[])[0];
		const tbs = tbsResponseData.value as forge.asn1.Asn1[];
		// Achar a SEQUENCE responses (uma SEQUENCE OF SingleResponse)
		// Os campos opcionais antes de responses têm tags context-specific [0]/[1].
		// Buscamos o primeiro SEQUENCE UNIVERSAL após version/responderID/producedAt.
		let responses: forge.asn1.Asn1[] | null = null;
		for (const f of tbs) {
			if (
				f.tagClass === forge.asn1.Class.UNIVERSAL &&
				f.type === forge.asn1.Type.SEQUENCE &&
				Array.isArray(f.value) &&
				f.value.length > 0 &&
				(f.value[0] as forge.asn1.Asn1).type === forge.asn1.Type.SEQUENCE
			) {
				responses = f.value as forge.asn1.Asn1[];
				break;
			}
		}
		if (!responses || responses.length === 0) return { status: 'unknown' };

		const single = responses[0].value as forge.asn1.Asn1[];
		// single[0] = certID; single[1] = certStatus
		const certStatus = single[1];
		// CHOICE: o tag indica o status
		// good = [0] IMPLICIT NULL (primitive)
		// revoked = [1] IMPLICIT RevokedInfo (constructed)
		// unknown = [2] IMPLICIT UnknownInfo
		if (
			certStatus.tagClass === forge.asn1.Class.CONTEXT_SPECIFIC &&
			(certStatus.type as number) === 0
		) {
			return { status: 'good', basicAsn1 };
		}
		if (
			certStatus.tagClass === forge.asn1.Class.CONTEXT_SPECIFIC &&
			(certStatus.type as number) === 1
		) {
			// RevokedInfo ::= SEQUENCE { revocationTime GeneralizedTime, ... }
			const revokedInfo = certStatus.value as forge.asn1.Asn1[];
			const revTime = revokedInfo[0]?.value as string | undefined;
			return { status: 'revoked', revokedAt: revTime, basicAsn1 };
		}
		return { status: 'unknown', basicAsn1 };
	} catch (e) {
		logger.warn('[OCSP] Falha ao parsear OCSPResponse', {
			error: e instanceof Error ? e.message : String(e)
		});
		return { status: 'unknown' };
	}
}

/**
 * Consulta o responder OCSP do certificado e retorna um snapshot completo
 * pronto para ser persistido (modelo CAdES-LT).
 *
 * Em caso de falha de rede / responder inválido, retorna um snapshot com
 * `status: 'unknown'` e `erro` descritivo. Não lança.
 */
export async function consultarOcsp(
	cert: forge.pki.Certificate,
	issuer: forge.pki.Certificate,
	timeoutMs = 10_000
): Promise<OcspSnapshot> {
	const consultadoEm = new Date().toISOString();
	const url = extrairUrlOcsp(cert);
	if (!url) {
		return {
			status: 'unknown',
			responseDerB64: '',
			url: '',
			consultadoEm,
			erro: 'Certificado sem URL OCSP no AIA'
		};
	}

	// Guard SSRF: nunca emitir o POST para host interno/privado (URL controlada
	// pelo certificado do usuário). Degrada para 'unknown' (igual a sem AIA).
	if (!urlOcspPermitida(url)) {
		logger.warn('[OCSP] URL do responder rejeitada pelo guard SSRF', { url });
		return {
			status: 'unknown',
			responseDerB64: '',
			url,
			consultadoEm,
			erro: 'URL OCSP não permitida (host interno/privado)'
		};
	}

	let requestDer: Uint8Array;
	let nonceEnviado: Uint8Array;
	try {
		const built = buildOcspRequestDer(cert, issuer);
		requestDer = built.requestDer;
		nonceEnviado = built.nonce;
	} catch (e) {
		return {
			status: 'unknown',
			responseDerB64: '',
			url,
			consultadoEm,
			erro: `Falha ao montar OCSPRequest: ${e instanceof Error ? e.message : String(e)}`
		};
	}

	const ctrl = new AbortController();
	const t = setTimeout(() => ctrl.abort(), timeoutMs);
	try {
		const res = await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/ocsp-request' },
			body: requestDer as unknown as ArrayBuffer,
			signal: ctrl.signal
		});
		if (!res.ok) {
			return {
				status: 'unknown',
				responseDerB64: '',
				url,
				consultadoEm,
				erro: `Responder retornou HTTP ${res.status}`
			};
		}
		const respBuf = new Uint8Array(await res.arrayBuffer());
		const respB64 = forge.util.encode64(
			Array.from(respBuf)
				.map((b) => String.fromCharCode(b))
				.join('')
		);
		const parsed = parseOcspStatus(respBuf);

		// Validar assinatura matemática + confiança do responder.
		let assinaturaResponder: 'valida' | 'invalida' | 'nao_verificada' = 'nao_verificada';
		let nonceEcoadoOk: boolean | undefined;
		if (parsed.basicAsn1) {
			assinaturaResponder = verificarSignatureBasic(parsed.basicAsn1, issuer);
			// Checar eco do nonce (apenas informativo — responder pode não suportar).
			const comp = extrairComponentesBasic(parsed.basicAsn1);
			if (comp) {
				const eco = verificarNonceEco(comp.responseExtensions, nonceEnviado);
				if (eco !== null) nonceEcoadoOk = eco;
			}
		}

		// Se o responder respondeu mas a assinatura é inválida, o status é
		// inutilizável — defesa contra MITM forjando "good" para cert revogado.
		if (assinaturaResponder === 'invalida') {
			return {
				status: 'unknown',
				responseDerB64: respB64,
				url,
				consultadoEm,
				erro: 'Assinatura do responder OCSP NÃO confere — possível MITM ou responder comprometido',
				assinaturaResponder
			};
		}

		return {
			status: parsed.status,
			revokedAt: parsed.revokedAt,
			responseDerB64: respB64,
			url,
			consultadoEm,
			assinaturaResponder,
			nonceEcoadoOk
		};
	} catch (e) {
		return {
			status: 'unknown',
			responseDerB64: '',
			url,
			consultadoEm,
			erro: e instanceof Error ? e.message : String(e)
		};
	} finally {
		clearTimeout(t);
	}
}

/**
 * Re-parseia uma resposta OCSP previamente armazenada (CAdES-LT) e
 * retorna o status + (opcionalmente) o resultado de validação da
 * assinatura do responder.
 *
 * Usado pela página /validar/[hash] na verificação offline.
 *
 * @param snapshotB64 - resposta OCSP em DER base64
 * @param issuer - issuer do certificado consultado (para validar signature).
 *                 Quando omitido, retorna apenas `status` sem validar
 *                 assinatura (compat com snapshots antigos onde o issuer
 *                 não está prontamente disponível).
 */
export function statusDeSnapshot(
	snapshotB64: string,
	issuer?: forge.pki.Certificate
): {
	status: StatusOcsp;
	revokedAt?: string;
	assinaturaResponder?: 'valida' | 'invalida' | 'nao_verificada';
} {
	if (!snapshotB64) return { status: 'unknown' };
	try {
		const der = forge.util.decode64(snapshotB64);
		const bytes = new Uint8Array(der.length);
		for (let i = 0; i < der.length; i++) bytes[i] = der.charCodeAt(i) & 0xff;
		const parsed = parseOcspStatus(bytes);
		let assinaturaResponder: 'valida' | 'invalida' | 'nao_verificada' = 'nao_verificada';
		if (parsed.basicAsn1 && issuer) {
			assinaturaResponder = verificarSignatureBasic(parsed.basicAsn1, issuer);
		}
		// Se temos o issuer e a assinatura não bate, status é inutilizável.
		if (assinaturaResponder === 'invalida') {
			return { status: 'unknown', assinaturaResponder };
		}
		return {
			status: parsed.status,
			revokedAt: parsed.revokedAt,
			assinaturaResponder
		};
	} catch {
		return { status: 'unknown' };
	}
}
