/**
 * Verificação criptográfica de assinaturas digitais PKCS#7/CMS embarcadas em PDF.
 *
 * Complementa `pdf-signing.ts` (que apenas gera). Aqui validamos:
 *   - integridade do PDF (re-hash do byte-range vs messageDigest)
 *   - assinatura RSA dos SignedAttributes
 *   - cadeia de confiança ICP-Brasil
 *   - presença e validade do carimbo de tempo qualificado (RFC 3161)
 *   - revogação via snapshot OCSP previamente carimbado (CAdES-LT)
 *
 * Toda a verificação é offline, exceto OCSP — que tem versão online
 * (`consultarOcsp` em `./ocsp.ts`) usada apenas no momento da assinatura.
 */

import forge from 'node-forge';
import { logger } from './logger';
import { loadTrustStore, trustStoreRequerido } from './icp-brasil/trust-store';
import { statusDeSnapshot, type StatusOcsp } from './ocsp';
import { mascararCPF } from '../utils';
import { detectarDss } from './pades-lt';

// OIDs reaproveitados de pdf-signing.ts
const OID_MESSAGE_DIGEST = '1.2.840.113549.1.9.4';
const OID_TST_INFO = '1.2.840.113549.1.9.16.1.4';
const OID_SIGNATURE_TIME_STAMP_TOKEN = '1.2.840.113549.1.9.16.2.14';

export interface VerificationCertificado {
	nome: string;
	cpf: string;
	cpfMascarado: string;
	issuer: string;
	serial: string;
	validoDe: string;
	validoAte: string;
}

export interface VerificationResult {
	valid: boolean;
	checks: {
		integridade: boolean;
		assinaturaRsa: boolean;
		cadeiaIcpBrasil: boolean | 'indisponivel';
		timestampQualificado: boolean;
		revogacao: StatusOcsp;
	};
	certificado?: VerificationCertificado;
	timestamp?: { tipo: 'act_icp' | 'servidor'; momento: string };
	/** Sinaliza se o PDF tem DSS Dictionary embarcado (PAdES-LT auto-contido). */
	padesLt?: { presente: boolean; certCount: number; ocspCount: number; crlCount: number };
	erros: string[];
}

// ---------------------------------------------------------------------------
// Extração de CMS e ByteRange do PDF
// ---------------------------------------------------------------------------

export interface CmsExtraido {
	cmsDer: Uint8Array;
	byteRange: [number, number, number, number];
	/** Bytes assinados, na ordem do byteRange (concatenados). */
	bytesAssinados: Uint8Array;
}

/**
 * Localiza o /ByteRange e /Contents da última assinatura embarcada no PDF
 * e retorna o CMS DER + os bytes que entraram no hash.
 */
export function extrairCmsDoPdf(pdfBytes: Uint8Array): CmsExtraido | null {
	// Trabalhamos em ASCII porque os marcadores /ByteRange e /Contents são ASCII;
	// os bytes binários da assinatura ficam dentro de <...> em hex.
	const ascii = new TextDecoder('latin1').decode(pdfBytes);

	// Pega a ÚLTIMA ocorrência de /ByteRange (a última assinatura é a "atual").
	const brRegex = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g;
	let lastBr: RegExpExecArray | null = null;
	let m: RegExpExecArray | null;
	while ((m = brRegex.exec(ascii)) !== null) lastBr = m;
	if (!lastBr) return null;

	const a = parseInt(lastBr[1]);
	const b = parseInt(lastBr[2]);
	const c = parseInt(lastBr[3]);
	const d = parseInt(lastBr[4]);

	// Os bytes da assinatura ficam em hex entre as posições [a+b, c-1] inclusive.
	// Mais especificamente, entre `<` (em a+b) e `>` (em c-1) há o conteúdo hex.
	const inicioMarcador = a + b;
	const fimMarcador = c; // c é onde começa o segundo trecho assinado
	if (
		inicioMarcador < 0 ||
		fimMarcador <= inicioMarcador ||
		fimMarcador > pdfBytes.length ||
		pdfBytes[inicioMarcador] !== 0x3c /* '<' */
	) {
		return null;
	}
	// Conteúdo hex: do byte após '<' até antes de '>'
	const hexInicio = inicioMarcador + 1;
	let hexFim = fimMarcador - 1;
	while (hexFim > hexInicio && pdfBytes[hexFim] !== 0x3e /* '>' */) hexFim--;
	if (hexFim <= hexInicio) return null;

	// Extrai os bytes hex (filtrando whitespace/zero-padding) e converte para DER.
	let hexStr = '';
	for (let i = hexInicio; i < hexFim; i++) {
		const ch = pdfBytes[i];
		if (
			(ch >= 0x30 && ch <= 0x39) ||
			(ch >= 0x41 && ch <= 0x46) ||
			(ch >= 0x61 && ch <= 0x66)
		) {
			hexStr += String.fromCharCode(ch);
		}
	}
	// Remove o padding `00` do final (Adobe permite até 8KB de placeholder zerado).
	while (hexStr.endsWith('00') && hexStr.length > 2) hexStr = hexStr.slice(0, -2);
	if (hexStr.length % 2 !== 0) hexStr = hexStr.slice(0, -1);

	const cmsLen = hexStr.length / 2;
	const cmsDer = new Uint8Array(cmsLen);
	for (let i = 0; i < cmsLen; i++) {
		cmsDer[i] = parseInt(hexStr.substr(i * 2, 2), 16);
	}

	// Bytes assinados = [a..a+b) ∪ [c..c+d)
	if (a + b > pdfBytes.length || c + d > pdfBytes.length) return null;
	const parte1 = pdfBytes.subarray(a, a + b);
	const parte2 = pdfBytes.subarray(c, c + d);
	const bytesAssinados = new Uint8Array(parte1.length + parte2.length);
	bytesAssinados.set(parte1, 0);
	bytesAssinados.set(parte2, parte1.length);

	return {
		cmsDer,
		byteRange: [a, b, c, d],
		bytesAssinados
	};
}

// ---------------------------------------------------------------------------
// Helpers ASN.1
// ---------------------------------------------------------------------------

function uint8ToBinaryString(b: Uint8Array): string {
	let s = '';
	for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
	return s;
}

function findChild(node: forge.asn1.Asn1, tagClass: number, type: number): forge.asn1.Asn1 | null {
	if (!Array.isArray(node.value)) return null;
	for (const child of node.value as forge.asn1.Asn1[]) {
		if (child.tagClass === tagClass && (child.type as number) === type) return child;
	}
	return null;
}

interface CmsParsed {
	signedData: forge.asn1.Asn1;
	signerInfo: forge.asn1.Asn1;
	certificate: forge.pki.Certificate;
	certificateAsn1: forge.asn1.Asn1;
	signedAttrs: forge.asn1.Asn1; // [0] IMPLICIT — para re-encode em SET
	signedAttrsAsSet: forge.asn1.Asn1; // mesma coisa, mas com tag SET (0x31)
	messageDigest: string; // bytes binários
	signatureValue: string; // bytes binários
	signingTimeISO?: string;
	timestampToken?: forge.asn1.Asn1;
}

/**
 * Parseia o CMS extraído do PDF e devolve as estruturas necessárias
 * para verificação.
 */
export function parseCms(cmsDer: Uint8Array): CmsParsed | null {
	try {
		const buf = forge.util.createBuffer(uint8ToBinaryString(cmsDer));
		const top = forge.asn1.fromDer(buf);
		// ContentInfo: SEQUENCE { contentType OID, content [0] EXPLICIT ANY }
		const contentInfoChildren = top.value as forge.asn1.Asn1[];
		const contentWrap = contentInfoChildren[1];
		const signedData = (contentWrap.value as forge.asn1.Asn1[])[0];
		const sd = signedData.value as forge.asn1.Asn1[];

		// SignedData: version, digestAlgorithms, encapContentInfo, [0] certs?, [1] crls?, signerInfos
		// signerInfos é o último SET universal.
		let signerInfos: forge.asn1.Asn1 | null = null;
		let certsImpl: forge.asn1.Asn1 | null = null;
		for (const f of sd) {
			if (f.tagClass === forge.asn1.Class.UNIVERSAL && f.type === forge.asn1.Type.SET) {
				signerInfos = f;
			} else if (
				f.tagClass === forge.asn1.Class.CONTEXT_SPECIFIC &&
				(f.type as number) === 0
			) {
				certsImpl = f;
			}
		}
		if (!signerInfos) return null;
		const signerInfo = (signerInfos.value as forge.asn1.Asn1[])[0];
		if (!signerInfo) return null;

		// Pega o primeiro certificado (signatário).
		if (!certsImpl) return null;
		const certificateAsn1 = (certsImpl.value as forge.asn1.Asn1[])[0];
		const certificate = forge.pki.certificateFromAsn1(certificateAsn1);

		// SignerInfo: version, sid, digestAlgorithm, [0] signedAttrs?, signatureAlgorithm, signature, [1] unsignedAttrs?
		const si = signerInfo.value as forge.asn1.Asn1[];
		let signedAttrs: forge.asn1.Asn1 | null = null;
		let unsignedAttrs: forge.asn1.Asn1 | null = null;
		let signatureValue: string | null = null;
		for (const f of si) {
			if (
				f.tagClass === forge.asn1.Class.CONTEXT_SPECIFIC &&
				(f.type as number) === 0 &&
				Array.isArray(f.value)
			) {
				signedAttrs = f;
			} else if (
				f.tagClass === forge.asn1.Class.CONTEXT_SPECIFIC &&
				(f.type as number) === 1
			) {
				unsignedAttrs = f;
			} else if (
				f.tagClass === forge.asn1.Class.UNIVERSAL &&
				f.type === forge.asn1.Type.OCTETSTRING
			) {
				signatureValue = f.value as string;
			}
		}
		if (!signedAttrs || !signatureValue) return null;

		// Re-codifica signedAttrs como SET (tag 0x31) — a assinatura é sobre essa forma.
		const signedAttrsAsSet = forge.asn1.create(
			forge.asn1.Class.UNIVERSAL,
			forge.asn1.Type.SET,
			true,
			signedAttrs.value as forge.asn1.Asn1[]
		);

		// Extrai messageDigest e signingTime dos SignedAttributes.
		let messageDigest = '';
		let signingTimeISO: string | undefined;
		for (const attr of signedAttrs.value as forge.asn1.Asn1[]) {
			const filhos = attr.value as forge.asn1.Asn1[];
			const oidBytes = filhos[0].value as string;
			const oid = forge.asn1.derToOid(oidBytes);
			const setVal = filhos[1].value as forge.asn1.Asn1[];
			if (oid === OID_MESSAGE_DIGEST) {
				messageDigest = setVal[0].value as string;
			} else if (oid === '1.2.840.113549.1.9.5') {
				const t = setVal[0];
				try {
					const d =
						t.type === forge.asn1.Type.UTCTIME
							? forge.asn1.utcTimeToDate(t.value as string)
							: forge.asn1.generalizedTimeToDate(t.value as string);
					signingTimeISO = d.toISOString();
				} catch {
					/* ignore */
				}
			}
		}

		// Extrai timestampToken dos UnsignedAttributes (se houver).
		let timestampToken: forge.asn1.Asn1 | undefined;
		if (unsignedAttrs) {
			for (const attr of unsignedAttrs.value as forge.asn1.Asn1[]) {
				const filhos = attr.value as forge.asn1.Asn1[];
				const oidBytes = filhos[0].value as string;
				const oid = forge.asn1.derToOid(oidBytes);
				if (oid === OID_SIGNATURE_TIME_STAMP_TOKEN) {
					timestampToken = (filhos[1].value as forge.asn1.Asn1[])[0];
					break;
				}
			}
		}

		return {
			signedData,
			signerInfo,
			certificate,
			certificateAsn1,
			signedAttrs,
			signedAttrsAsSet,
			messageDigest,
			signatureValue,
			signingTimeISO,
			timestampToken
		};
	} catch (e) {
		logger.warn('[PDF-VERIFY] Falha ao parsear CMS', {
			error: e instanceof Error ? e.message : String(e)
		});
		return null;
	}
}

// ---------------------------------------------------------------------------
// Verificações individuais
// ---------------------------------------------------------------------------

export async function verificarIntegridadePdf(
	bytesAssinados: Uint8Array,
	expectedDigestBytes: string
): Promise<boolean> {
	const hash = await crypto.subtle.digest(
		'SHA-256',
		bytesAssinados as unknown as ArrayBuffer
	);
	const arr = new Uint8Array(hash);
	if (arr.length !== expectedDigestBytes.length) return false;
	for (let i = 0; i < arr.length; i++) {
		if (arr[i] !== (expectedDigestBytes.charCodeAt(i) & 0xff)) return false;
	}
	return true;
}

export function verificarAssinaturaRsa(
	cert: forge.pki.Certificate,
	signedAttrsAsSet: forge.asn1.Asn1,
	signatureValue: string
): boolean {
	try {
		const md = forge.md.sha256.create();
		const der = forge.asn1.toDer(signedAttrsAsSet).getBytes();
		md.update(der);
		const pubKey = cert.publicKey as forge.pki.rsa.PublicKey;
		return pubKey.verify(md.digest().getBytes(), signatureValue);
	} catch (e) {
		logger.warn('[PDF-VERIFY] Falha na verificação RSA', {
			error: e instanceof Error ? e.message : String(e)
		});
		return false;
	}
}

export function verificarCadeiaIcpBrasil(
	cert: forge.pki.Certificate
): boolean | 'indisponivel' {
	const ts = loadTrustStore();
	if (!ts.disponivel) return 'indisponivel';
	try {
		// forge.pki.verifyCertificateChain aceita um array começando pelo end-entity.
		// Sem intermediárias explícitas no CMS, dependemos de o caStore conter todas as
		// ACs (raízes + intermediárias) — modelo "trust store completo".
		return forge.pki.verifyCertificateChain(ts.caStore, [cert]);
	} catch (e) {
		logger.info('[PDF-VERIFY] Cadeia ICP-Brasil inválida', {
			subject: cert.subject.getField('CN')?.value,
			error: e instanceof Error ? e.message : String(e)
		});
		return false;
	}
}

/**
 * Valida o token RFC 3161 contra o messageImprint = hash(signatureValue).
 * Retorna o ISO 8601 do `genTime` se válido, ou `null`.
 */
export function verificarTimestampToken(
	tstWrapper: forge.asn1.Asn1,
	signatureValue: string
): { momento: string } | null {
	try {
		// tstWrapper é um ContentInfo (TimeStampToken). Extrai TSTInfo.
		const ci = tstWrapper.value as forge.asn1.Asn1[];
		const sdWrap = ci[1];
		const signedData = (sdWrap.value as forge.asn1.Asn1[])[0];
		const sd = signedData.value as forge.asn1.Asn1[];
		// encapContentInfo está em sd[2]: SEQUENCE { OID, [0] EXPLICIT OCTET STRING TSTInfo }
		const encap = sd[2];
		const encapChildren = encap.value as forge.asn1.Asn1[];
		const encapWrap = encapChildren[1];
		const tstInfoOctet = (encapWrap.value as forge.asn1.Asn1[])[0];
		const tstInfoDer = tstInfoOctet.value as string;
		const tstInfo = forge.asn1.fromDer(tstInfoDer);
		const ti = tstInfo.value as forge.asn1.Asn1[];
		// TSTInfo: version, policy, messageImprint, serialNumber, genTime, ...
		const messageImprint = ti[2];
		const miChildren = messageImprint.value as forge.asn1.Asn1[];
		const miHash = miChildren[1].value as string;
		// genTime é GeneralizedTime
		let genTimeISO: string | null = null;
		for (let i = 3; i < ti.length; i++) {
			if (ti[i].type === forge.asn1.Type.GENERALIZEDTIME) {
				try {
					genTimeISO = forge.asn1.generalizedTimeToDate(ti[i].value as string).toISOString();
				} catch {
					/* ignore */
				}
				break;
			}
		}

		// messageImprint deve ser hash(signatureValue) — algoritmo do TSP (geralmente SHA-256)
		const md = forge.md.sha256.create();
		md.update(signatureValue);
		const expected = md.digest().getBytes();
		if (expected.length !== miHash.length) return null;
		for (let i = 0; i < expected.length; i++) {
			if (expected.charCodeAt(i) !== miHash.charCodeAt(i)) return null;
		}

		return genTimeISO ? { momento: genTimeISO } : null;
	} catch (e) {
		logger.warn('[PDF-VERIFY] Falha ao verificar TimeStampToken', {
			error: e instanceof Error ? e.message : String(e)
		});
		return null;
	}
}

// ---------------------------------------------------------------------------
// Orquestrador
// ---------------------------------------------------------------------------

export interface VerifyOptions {
	/** Snapshot OCSP previamente armazenado (CAdES-LT). */
	ocspSnapshotB64?: string | null;
	/** Tipo de carimbo registrado no banco (auditoria adicional). */
	tipoCarimboTempoArmazenado?: 'servidor' | 'act_icp' | null;
	/**
	 * `platform.env` para checar `ICP_BRASIL_TRUST_STORE_REQUIRED`. Quando
	 * essa env está ligada e o trust store está vazio, devolvemos
	 * `valid: false` em vez de aceitar com warning — assim a página /validar
	 * deixa claro que a cadeia não pôde ser validada.
	 */
	env?: Record<string, string | undefined>;
}

export async function verificarAssinaturaCompleta(
	pdfBytes: Uint8Array,
	options: VerifyOptions = {}
): Promise<VerificationResult> {
	const erros: string[] = [];
	const result: VerificationResult = {
		valid: false,
		checks: {
			integridade: false,
			assinaturaRsa: false,
			cadeiaIcpBrasil: false,
			timestampQualificado: false,
			revogacao: 'unknown'
		},
		erros
	};

	const extracao = extrairCmsDoPdf(pdfBytes);
	if (!extracao) {
		erros.push('CMS não encontrado no PDF (campo /ByteRange ausente)');
		return result;
	}

	const cms = parseCms(extracao.cmsDer);
	if (!cms) {
		erros.push('Falha ao parsear estrutura CMS do PDF');
		return result;
	}

	// Certificado (metadados)
	try {
		const cn = (cms.certificate.subject.getField('CN')?.value as string) || '';
		let cpf = '';
		const sn = cms.certificate.subject.getField('serialNumber');
		if (sn) cpf = String(sn.value).replace(/\D/g, '');
		if (!cpf && cn.includes(':')) {
			cpf = cn.split(':').pop()?.replace(/\D/g, '') || '';
		}
		if (cpf.length > 11) cpf = cpf.slice(-11);

		result.certificado = {
			nome: cn.split(':')[0].trim(),
			cpf,
			cpfMascarado: cpf ? mascararCPF(cpf) : '',
			issuer: (cms.certificate.issuer.getField('CN')?.value as string) || '',
			serial: cms.certificate.serialNumber,
			validoDe: cms.certificate.validity.notBefore.toISOString(),
			validoAte: cms.certificate.validity.notAfter.toISOString()
		};
	} catch {
		erros.push('Falha ao extrair metadados do certificado');
	}

	// 1. Integridade
	result.checks.integridade = await verificarIntegridadePdf(
		extracao.bytesAssinados,
		cms.messageDigest
	);
	if (!result.checks.integridade) {
		erros.push('Hash do conteúdo do PDF não confere com o messageDigest assinado');
	}

	// 2. Assinatura RSA
	result.checks.assinaturaRsa = verificarAssinaturaRsa(
		cms.certificate,
		cms.signedAttrsAsSet,
		cms.signatureValue
	);
	if (!result.checks.assinaturaRsa) {
		erros.push('Assinatura RSA dos SignedAttributes inválida');
	}

	// 3. Cadeia ICP-Brasil
	const cadeia = verificarCadeiaIcpBrasil(cms.certificate);
	result.checks.cadeiaIcpBrasil = cadeia;
	if (cadeia === false) {
		erros.push('Certificado não encadeia até uma AC Raiz da ICP-Brasil reconhecida');
	}

	// 4. Carimbo de tempo qualificado
	if (cms.timestampToken) {
		const tst = verificarTimestampToken(cms.timestampToken, cms.signatureValue);
		if (tst) {
			result.checks.timestampQualificado = true;
			result.timestamp = { tipo: 'act_icp', momento: tst.momento };
		} else {
			erros.push('Token TSA presente mas inválido (messageImprint não confere)');
			result.timestamp = { tipo: 'servidor', momento: cms.signingTimeISO ?? '' };
		}
	} else if (cms.signingTimeISO) {
		result.timestamp = { tipo: 'servidor', momento: cms.signingTimeISO };
	}

	// 5. Revogação (snapshot OCSP)
	if (options.ocspSnapshotB64) {
		const snap = statusDeSnapshot(options.ocspSnapshotB64);
		result.checks.revogacao = snap.status;
		if (snap.status === 'revoked') {
			erros.push(
				`Certificado REVOGADO${snap.revokedAt ? ` em ${snap.revokedAt}` : ''} (snapshot OCSP)`
			);
		}
	} else {
		result.checks.revogacao = 'unknown';
	}

	// 6. Detecção de PAdES-LT (DSS Dictionary)
	try {
		result.padesLt = await detectarDss(pdfBytes);
	} catch {
		/* falha aqui não invalida — apenas não exibe badge PAdES-LT */
	}

	// Resultado consolidado: válido apenas se TODOS os checks essenciais passaram.
	//
	// Política de cadeia "indisponivel":
	//   - default: trata como ok (legado, trust store em fase de implantação)
	//   - com ICP_BRASIL_TRUST_STORE_REQUIRED=true: trata como inválido (não
	//     dá pra afirmar que é qualificada sem validar a cadeia).
	const cadeiaOk =
		cadeia === true ||
		(cadeia === 'indisponivel' && !trustStoreRequerido(options.env));
	if (cadeia === 'indisponivel' && trustStoreRequerido(options.env)) {
		erros.push(
			'Trust store ICP-Brasil não populado neste servidor — não foi possível validar a cadeia.'
		);
	}
	result.valid =
		result.checks.integridade &&
		result.checks.assinaturaRsa &&
		cadeiaOk &&
		result.checks.revogacao !== 'revoked';

	return result;
}
