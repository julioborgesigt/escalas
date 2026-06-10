/**
 * Cliente TSA RFC 3161 (Time-Stamp Protocol) compatível com Cloudflare Workers.
 *
 * Pega o `signatureValue` (RSA bytes assinados) de um CMS já assinado pelo
 * cliente (Web PKI ou SERPRO), monta um `TimeStampReq` em DER, envia ao
 * endpoint TSA configurado em `TSA_URL` e devolve o `TimeStampToken` para
 * ser anexado aos `UnsignedAttributes` do `SignerInfo`.
 *
 * Importante:
 *   - A TSA carimba sobre `SHA-256(signatureValue)` — o "messageImprint" do
 *     TST aponta para a assinatura RSA, comprovando que ela existia naquele
 *     momento (e portanto que o documento, que ela cobre, também existia).
 *   - Não é necessário (nem desejável) o servidor "re-assinar" o documento.
 *     O TST anexado em UnsignedAttributes preserva a validade da RSA original.
 *   - Aceitamos basic auth opcional para ACTs comerciais (Bry, Soluti) que
 *     restringem o endpoint.
 *
 * Referências:
 *   - RFC 3161 (Time-Stamp Protocol)
 *   - RFC 5816 (ESS Update — algoritmos modernos)
 *   - DOC-ICP-15 (PA-AD-RB requer TST de ACT credenciada)
 */

import forge from 'node-forge';
import { logger } from './logger';
import { urlOcspPermitida } from './ocsp';

const OID_SHA256 = '2.16.840.1.101.3.4.2.1';

export type TsaConfig = {
	url: string;
	username?: string;
	password?: string;
	/** Timeout do fetch em ms (default 15 s). */
	timeoutMs?: number;
};

export type TsaResult =
	| {
			ok: true;
			/** TimeStampToken (ContentInfo) em DER, pronto para virar attrValue. */
			tstDer: Uint8Array;
			/** Mesmo TimeStampToken já parseado para forge.asn1.Asn1. */
			tstAsn1: forge.asn1.Asn1;
	  }
	| {
			ok: false;
			/** Mensagem curta para log/UI. */
			error: string;
	  };

/**
 * Monta o `TimeStampReq` DER conforme RFC 3161 §2.4.1.
 *
 * Estratégia minimalista:
 *   - `version` = 1
 *   - `messageImprint` = { sha256, hash(signatureValue) }
 *   - `reqPolicy` omitido (deixamos a TSA escolher a policy default)
 *   - `nonce` = 64 bits aleatórios (mitiga replay; opcional pela RFC)
 *   - `certReq` = TRUE (queremos o cert do responder no TST, para auditar offline)
 */
function montarTimeStampReq(signatureValue: string): Uint8Array {
	// SHA-256 do signatureValue (bytes binários do campo signature do CMS).
	const md = forge.md.sha256.create();
	md.update(signatureValue);
	const hashedMessage = md.digest().getBytes();

	// 64 bits de nonce aleatório.
	const nonceBytes = crypto.getRandomValues(new Uint8Array(8));
	// INTEGER em DER tem semântica two's-complement: para garantir positivo,
	// força o bit mais significativo a 0.
	nonceBytes[0] = nonceBytes[0] & 0x7f;
	let nonceStr = '';
	for (const b of nonceBytes) nonceStr += String.fromCharCode(b);

	const algSha256 = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
		forge.asn1.create(
			forge.asn1.Class.UNIVERSAL,
			forge.asn1.Type.OID,
			false,
			forge.asn1.oidToDer(OID_SHA256).getBytes()
		),
		forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.NULL, false, '')
	]);

	const messageImprint = forge.asn1.create(
		forge.asn1.Class.UNIVERSAL,
		forge.asn1.Type.SEQUENCE,
		true,
		[
			algSha256,
			forge.asn1.create(
				forge.asn1.Class.UNIVERSAL,
				forge.asn1.Type.OCTETSTRING,
				false,
				hashedMessage
			)
		]
	);

	const tsq = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
		// version v1
		forge.asn1.create(
			forge.asn1.Class.UNIVERSAL,
			forge.asn1.Type.INTEGER,
			false,
			forge.asn1.integerToDer(1).getBytes()
		),
		messageImprint,
		// nonce (positivo, big-endian)
		forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.INTEGER, false, nonceStr),
		// certReq = TRUE
		forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.BOOLEAN, false, '\xff')
	]);

	const der = forge.asn1.toDer(tsq).getBytes();
	const out = new Uint8Array(der.length);
	for (let i = 0; i < der.length; i++) out[i] = der.charCodeAt(i) & 0xff;
	return out;
}

/**
 * Faz parse do `TimeStampResp` e devolve apenas o `TimeStampToken`
 * (ContentInfo aninhado), que é o que vai como attrValue no CMS.
 *
 * RFC 3161 §2.4.2:
 *   TimeStampResp ::= SEQUENCE { status PKIStatusInfo, timeStampToken OPTIONAL }
 *   PKIStatusInfo ::= SEQUENCE { status PKIStatus, statusString ..., failInfo ... }
 *   PKIStatus 0 = granted, 1 = grantedWithMods (aceitamos os dois)
 */
function extrairTokenDaResposta(respDer: Uint8Array): {
	tstDer: Uint8Array;
	tstAsn1: forge.asn1.Asn1;
} {
	let binStr = '';
	for (const b of respDer) binStr += String.fromCharCode(b);
	const asn1 = forge.asn1.fromDer(forge.util.createBuffer(binStr));
	const children = asn1.value as forge.asn1.Asn1[];

	const statusInfo = children[0];
	const statusBytes = (statusInfo.value as forge.asn1.Asn1[])[0].value as string;
	const statusInt = statusBytes.charCodeAt(0);
	if (statusInt !== 0 && statusInt !== 1) {
		throw new Error(`TSA rejeitou a requisição (PKIStatus=${statusInt})`);
	}

	const token = children[1];
	if (!token) throw new Error('TSA aceitou mas não devolveu TimeStampToken');

	const der = forge.asn1.toDer(token).getBytes();
	const out = new Uint8Array(der.length);
	for (let i = 0; i < der.length; i++) out[i] = der.charCodeAt(i) & 0xff;
	return { tstDer: out, tstAsn1: token };
}

/**
 * Solicita um carimbo de tempo à TSA configurada.
 *
 * Falha-silenciosa: nunca lança. Em qualquer erro de rede, timeout, status
 * HTTP não-200 ou PKIStatus rejeitado, devolve `{ ok: false, error }`. O
 * caller decide se isso bloqueia o fluxo (via `EXIGIR_TSA_QUALIFICADA`) ou
 * apenas vira aviso.
 */
export async function solicitarCarimboTempo(
	signatureValue: string,
	config: TsaConfig
): Promise<TsaResult> {
	// Mesmo guard SSRF do OCSP: a URL vem de env (operador), mas se algum dia
	// for derivada de configuração editável por admin, o POST nunca pode sair
	// para host interno/privado/metadados de nuvem.
	if (!urlOcspPermitida(config.url)) {
		logger.warn('[TSA] URL da TSA rejeitada pelo guard SSRF', { url: config.url });
		return { ok: false, error: 'URL da TSA aponta para host não permitido' };
	}

	let reqDer: Uint8Array;
	try {
		reqDer = montarTimeStampReq(signatureValue);
	} catch (e) {
		return {
			ok: false,
			error: `Falha ao montar TimeStampReq: ${e instanceof Error ? e.message : String(e)}`
		};
	}

	const headers: Record<string, string> = {
		'Content-Type': 'application/timestamp-query',
		Accept: 'application/timestamp-reply'
	};
	if (config.username && config.password) {
		// HTTP Basic — funciona em Cloudflare Workers via btoa.
		const creds = `${config.username}:${config.password}`;
		const b64 = typeof btoa !== 'undefined' ? btoa(creds) : Buffer.from(creds).toString('base64');
		headers.Authorization = `Basic ${b64}`;
	}

	const ctrl = new AbortController();
	const t = setTimeout(() => ctrl.abort(), config.timeoutMs ?? 15_000);
	try {
		const res = await fetch(config.url, {
			method: 'POST',
			headers,
			body: reqDer as unknown as ArrayBuffer,
			signal: ctrl.signal
		});
		if (!res.ok) {
			return { ok: false, error: `TSA retornou HTTP ${res.status}` };
		}
		const respBytes = new Uint8Array(await res.arrayBuffer());
		const token = extrairTokenDaResposta(respBytes);
		return { ok: true, tstDer: token.tstDer, tstAsn1: token.tstAsn1 };
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		logger.warn('[TSA] Falha ao solicitar carimbo de tempo', {
			url: config.url,
			error: msg
		});
		return { ok: false, error: msg };
	} finally {
		clearTimeout(t);
	}
}
