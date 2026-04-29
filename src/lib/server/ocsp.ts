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

const OID_OCSP_BASIC = '1.3.6.1.5.5.7.48.1.1';
const OID_OCSP_AIA = '1.3.6.1.5.5.7.48.1';
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
 * Constrói o CertID (RFC 6960) usando SHA-1 (algoritmo padrão).
 */
function buildCertId(
	cert: forge.pki.Certificate,
	issuer: forge.pki.Certificate
): forge.asn1.Asn1 {
	// issuerNameHash = SHA-1(DER do subject do issuer)
	const issuerSubjectAsn1 = forge.pki.distinguishedNameToAsn1(issuer.subject);
	const issuerSubjectDer = forge.asn1.toDer(issuerSubjectAsn1).getBytes();
	const md1 = forge.md.sha1.create();
	md1.update(issuerSubjectDer);
	const issuerNameHash = md1.digest().getBytes();

	// issuerKeyHash = SHA-1(BIT STRING value da chave pública do issuer)
	const pubKeyAsn1 = forge.pki.publicKeyToAsn1(issuer.publicKey);
	// SubjectPublicKeyInfo: o último filho é o BIT STRING; pegamos seu value (sem o byte de unused bits)
	const spki = pubKeyAsn1.value as forge.asn1.Asn1[];
	const bitString = spki[spki.length - 1];
	const bitStringBytes = bitString.value as string;
	// O primeiro byte do BIT STRING é o número de bits não usados — descartar
	const keyBytes = bitStringBytes.startsWith('\x00') ? bitStringBytes.slice(1) : bitStringBytes;
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
 */
function buildOcspRequestDer(
	cert: forge.pki.Certificate,
	issuer: forge.pki.Certificate
): Uint8Array {
	const certId = buildCertId(cert, issuer);
	const request = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
		certId
	]);
	const requestList = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
		request
	]);
	const tbsRequest = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
		requestList
	]);
	const ocspRequest = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
		tbsRequest
	]);
	const der = forge.asn1.toDer(ocspRequest).getBytes();

	const bytes = new Uint8Array(der.length);
	for (let i = 0; i < der.length; i++) bytes[i] = der.charCodeAt(i) & 0xff;
	return bytes;
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
} {
	try {
		const buffer = forge.util.createBuffer(
			String.fromCharCode(...Array.from(responseDer))
		);
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
			return { status: 'good' };
		}
		if (
			certStatus.tagClass === forge.asn1.Class.CONTEXT_SPECIFIC &&
			(certStatus.type as number) === 1
		) {
			// RevokedInfo ::= SEQUENCE { revocationTime GeneralizedTime, ... }
			const revokedInfo = certStatus.value as forge.asn1.Asn1[];
			const revTime = revokedInfo[0]?.value as string | undefined;
			return { status: 'revoked', revokedAt: revTime };
		}
		return { status: 'unknown' };
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

	let requestDer: Uint8Array;
	try {
		requestDer = buildOcspRequestDer(cert, issuer);
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
		return {
			status: parsed.status,
			revokedAt: parsed.revokedAt,
			responseDerB64: respB64,
			url,
			consultadoEm
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
 * retorna apenas o status. Usado pela página /validar/[hash] sem
 * consultar a rede.
 */
export function statusDeSnapshot(snapshotB64: string): {
	status: StatusOcsp;
	revokedAt?: string;
} {
	if (!snapshotB64) return { status: 'unknown' };
	try {
		const der = forge.util.decode64(snapshotB64);
		const bytes = new Uint8Array(der.length);
		for (let i = 0; i < der.length; i++) bytes[i] = der.charCodeAt(i) & 0xff;
		return parseOcspStatus(bytes);
	} catch {
		return { status: 'unknown' };
	}
}
