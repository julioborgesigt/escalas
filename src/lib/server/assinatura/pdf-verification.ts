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
import { extrairDadosDoCertificado } from './pdf-signing-prepare';
import { binStringToBytes, bytesToBinString } from '$lib/crypto/bin';
import { PDFDocument } from 'pdf-lib';
import { logger } from '../logger';
import { loadTrustStore, trustStoreRequerido } from './icp-brasil/trust-store';
import { encontrarIssuerNoTrustStore } from './icp-brasil/cert-cn';
import { statusDeSnapshot, type StatusOcsp } from './ocsp';
import { mascararCPF } from '../../utils/pii';
import { detectarDss } from './pades-lt';
import { verificarAssinaturaCms, SIGNATURE_OIDS, DIGEST_OIDS } from './crypto-verify';
import { OID_SIG_POLICY_ID, avaliarPoliticaAssinatura, type AvaliacaoPolitica } from './icp-policy';
import { mensagemDeErro } from '$lib/utils/erro';

// OIDs reaproveitados de pdf-signing.ts
const OID_MESSAGE_DIGEST = '1.2.840.113549.1.9.4';
const OID_SIGNATURE_TIME_STAMP_TOKEN = '1.2.840.113549.1.9.16.2.14';

interface VerificationCertificado {
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
		/**
		 * A assinatura do RESPONDEDOR OCSP foi conferida?
		 *
		 * `statusDeSnapshot` já calculava isto e só o usava para a falha dura
		 * (`invalida` → veredito inválido). O caso `nao_verificada` era descartado
		 * em silêncio, e ele não é raro nem inofensivo: acontece quando o issuer
		 * não é localizado no trust store, e aí um `good` do snapshot é aceito
		 * SEM prova criptográfica — sustentando "não revogado" com o que é, ali,
		 * só um blob parseado. Quem audita precisa distinguir os dois.
		 */
		revogacaoAssinaturaResponder: 'valida' | 'invalida' | 'nao_verificada';
		/**
		 * O /ByteRange da assinatura principal cobre o arquivo INTEIRO (ou o
		 * que sobra após `c+d` é apenas um incremental update DSS legítimo).
		 * Sem este check, um atacante anexa um incremental update redefinindo
		 * páginas/objetos após a região assinada ("shadow attack") e os demais
		 * checks continuam passando.
		 */
		cobertura: boolean;
	};
	certificado?: VerificationCertificado;
	timestamp?: { tipo: 'act_icp' | 'servidor' | 'tsa_externa'; momento: string };
	/** Política de assinatura declarada (id-aa-ets-sigPolicyId) — informativo. */
	politica?: AvaliacaoPolitica;
	/** Sinaliza se o PDF tem DSS Dictionary embarcado (PAdES-LT auto-contido). */
	padesLt?: { presente: boolean; certCount: number; ocspCount: number; crlCount: number };
	erros: string[];
	/**
	 * Resumo das assinaturas adicionais quando o PDF tem mais de 1
	 * (workflow multi-signature). A "principal" do resultado é sempre a
	 * última. Cada item: subject/serial + status individual de integridade.
	 */
	assinaturasAdicionais?: Array<{
		ordem: number;
		signerCN: string;
		serial: string;
		integridade: boolean;
		assinaturaRsa: boolean;
	}>;
}

// ---------------------------------------------------------------------------
// Extração de CMS e ByteRange do PDF
// ---------------------------------------------------------------------------

interface CmsExtraido {
	cmsDer: Uint8Array;
	byteRange: [number, number, number, number];
	/** Bytes assinados, na ordem do byteRange (concatenados). */
	bytesAssinados: Uint8Array;
}

/**
 * Lê o comprimento TOTAL (header + conteúdo) do objeto DER que começa em
 * `bytes[0]` (a SEQUENCE externa do ContentInfo CMS). Retorna `null` se o
 * cabeçalho for inválido/indefinido ou estourar o buffer. Robusto a padding
 * de zeros após o objeto (o placeholder /Contents é zerado).
 */
export function lerComprimentoDerTotal(bytes: Uint8Array): number | null {
	if (bytes.length < 2) return null;
	let pos = 1; // após o byte de tag (0x30 para SEQUENCE)
	const lenByte = bytes[pos++];
	if (lenByte < 0x80) {
		return pos + lenByte; // forma curta
	}
	const n = lenByte & 0x7f;
	if (n === 0 || n > 4) return null; // indefinido (não-DER) ou absurdo
	if (bytes.length < pos + n) return null;
	let len = 0;
	for (let i = 0; i < n; i++) len = len * 256 + bytes[pos++];
	return pos + len;
}

/**
 * Extrai 1 assinatura a partir de um match de /ByteRange. Retorna `null`
 * se a estrutura não bate (PDF corrompido ou ByteRange órfão).
 */
function extrairAssinaturaDeByteRange(
	pdfBytes: Uint8Array,
	a: number,
	b: number,
	c: number,
	d: number
): CmsExtraido | null {
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

	// Extrai TODOS os bytes hex (whitespace filtrado). NÃO removemos o padding
	// `00` final por heurística: quando o CMS termina legitimamente em 0x00 (ex.:
	// assinatura RSA cujo último byte é 0x00, ~1/256), isso truncava o DER e o
	// parse falhava ("too long"). Em vez disso, lemos o comprimento real do
	// objeto DER (SEQUENCE externa) e fatiamos exatamente, ignorando o padding.
	let hexStr = '';
	for (let i = hexInicio; i < hexFim; i++) {
		const ch = pdfBytes[i];
		if ((ch >= 0x30 && ch <= 0x39) || (ch >= 0x41 && ch <= 0x46) || (ch >= 0x61 && ch <= 0x66)) {
			hexStr += String.fromCharCode(ch);
		}
	}
	if (hexStr.length % 2 !== 0) hexStr = hexStr.slice(0, -1);

	const fullLen = hexStr.length / 2;
	const fullBytes = new Uint8Array(fullLen);
	for (let i = 0; i < fullLen; i++) {
		fullBytes[i] = parseInt(hexStr.substr(i * 2, 2), 16);
	}

	// Comprimento total do objeto DER a partir do header (tag + length).
	const derTotal = lerComprimentoDerTotal(fullBytes);
	let cmsDer: Uint8Array;
	if (derTotal !== null && derTotal > 0 && derTotal <= fullLen) {
		cmsDer = fullBytes.slice(0, derTotal);
	} else {
		// Fallback (DER não-parseável aqui): remove padding `00` final como antes.
		let h = hexStr;
		while (h.endsWith('00') && h.length > 2) h = h.slice(0, -2);
		const n = h.length / 2;
		cmsDer = new Uint8Array(n);
		for (let i = 0; i < n; i++) cmsDer[i] = parseInt(h.substr(i * 2, 2), 16);
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

/**
 * Extrai TODAS as assinaturas embarcadas no PDF, na ordem em que aparecem
 * (mais antiga → mais recente). Cada incremental update adiciona uma nova
 * /ByteRange ao final do arquivo, então a última do array é a "atual".
 *
 * Usado por `verificarAssinaturaCompleta` para validar workflows multi-
 * assinatura (ex.: documento assinado pelo OIP e depois pelo DPC). Antes,
 * só a última assinatura era validada — uma assinatura anterior corrompida
 * passava despercebida.
 */
function extrairTodasCmsDoPdf(pdfBytes: Uint8Array): CmsExtraido[] {
	const ascii = new TextDecoder('latin1').decode(pdfBytes);
	const brRegex = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g;
	const out: CmsExtraido[] = [];
	let m: RegExpExecArray | null;
	while ((m = brRegex.exec(ascii)) !== null) {
		const a = parseInt(m[1]);
		const b = parseInt(m[2]);
		const c = parseInt(m[3]);
		const d = parseInt(m[4]);
		const cms = extrairAssinaturaDeByteRange(pdfBytes, a, b, c, d);
		if (cms) out.push(cms);
	}
	return out;
}

/**
 * Índice da assinatura "principal" entre as extraídas: a de MAIOR cobertura
 * (`c+d`). Usar a última na ordem do arquivo permitiria que um atacante
 * anexasse um CMS próprio com /ByteRange minúsculo ao final e o promovesse
 * a principal. Empate (não deveria ocorrer) resolve para a mais recente.
 */
function indiceAssinaturaPrincipal(todas: CmsExtraido[]): number {
	let melhor = -1;
	let melhorFim = -1;
	for (let i = 0; i < todas.length; i++) {
		const [, , c, d] = todas[i].byteRange;
		if (c + d >= melhorFim) {
			melhorFim = c + d;
			melhor = i;
		}
	}
	return melhor;
}

/**
 * Extrai a assinatura CMS do PDF — a PRINCIPAL, quando há mais de uma.
 *
 * Um PDF assinado em incrementos carrega várias entradas `/ByteRange`, uma por
 * assinatura. A escolhida é a de maior alcance (`indiceAssinaturaPrincipal`),
 * isto é, a que cobre mais bytes do arquivo: é ela que atesta o documento
 * inteiro como está hoje. Pegar a primeira validaria uma versão anterior e
 * ignoraria tudo que foi acrescentado depois — o vetor do shadow attack.
 *
 * `null` quando não há `/ByteRange` algum: PDF não assinado.
 */
export function extrairCmsDoPdf(pdfBytes: Uint8Array): CmsExtraido | null {
	const todas = extrairTodasCmsDoPdf(pdfBytes);
	if (todas.length === 0) return null;
	return todas[indiceAssinaturaPrincipal(todas)];
}

// ---------------------------------------------------------------------------
// Cobertura do ByteRange (anti shadow-attack)
// ---------------------------------------------------------------------------

const LATIN1 = new TextDecoder('latin1');

/** Próximo número de objeto livre da revisão assinada (mesma heurística de pades-lt). */
function proximoObjetoLivre(texto: string): number {
	let max = 0;
	for (const m of texto.matchAll(/(?:^|[\r\n])\s*(\d+)\s+\d+\s+obj\b/g)) {
		const n = parseInt(m[1], 10);
		if (Number.isFinite(n) && n >= max) max = n + 1;
	}
	for (const m of texto.matchAll(/\/Size\s+(\d+)/g)) {
		const n = parseInt(m[1], 10);
		if (Number.isFinite(n) && n > max) max = n;
	}
	return max;
}

function bytesSaoWhitespace(bytes: Uint8Array): boolean {
	for (const b of bytes) {
		if (b !== 0x20 && b !== 0x0a && b !== 0x0d && b !== 0x09 && b !== 0x00 && b !== 0x0c) {
			return false;
		}
	}
	return true;
}

/**
 * Valida que o conteúdo APÓS o fim do /ByteRange é um incremental update DSS
 * legítimo (PAdES-LT, gerado por `aplicarDss`) e não uma adulteração
 * ("hide-and-replace"). Regras:
 *   - termina em %%EOF e contém /DSS; não contém novo /ByteRange;
 *   - só pode redefinir o objeto Root (catalog) — qualquer outro número de
 *     objeto já existente na revisão assinada é rejeitado;
 *   - todo /Root dos trailers anexados aponta para o MESMO objeto da revisão
 *     assinada;
 *   - o catalog resultante é idêntico ao da revisão assinada, exceto pela
 *     entrada /DSS adicionada (impede troca de /Pages, /OpenAction etc.).
 */
async function trailingEhDssLegitimo(
	pdfBytes: Uint8Array,
	fimAssinado: number
): Promise<{ ok: boolean; motivo?: string }> {
	const assinado = LATIN1.decode(pdfBytes.subarray(0, fimAssinado));
	const trailing = LATIN1.decode(pdfBytes.subarray(fimAssinado));

	if (!/%%EOF\s*$/.test(trailing)) {
		return { ok: false, motivo: 'conteúdo anexado após a assinatura não termina em %%EOF' };
	}
	if (/\/ByteRange\b/.test(trailing)) {
		// Outra assinatura após a principal teria cobertura MAIOR e seria a
		// principal; um /ByteRange aqui é estrutura órfã/forjada.
		return {
			ok: false,
			motivo: 'estrutura de assinatura órfã anexada após a assinatura principal'
		};
	}
	if (!/\/DSS\b/.test(trailing)) {
		return { ok: false, motivo: 'conteúdo anexado após a assinatura não é um DSS (PAdES-LT)' };
	}

	// /Root da revisão assinada (última ocorrência = trailer vigente ao assinar).
	let rootNum = -1;
	for (const m of assinado.matchAll(/\/Root\s+(\d+)\s+\d+\s+R\b/g)) {
		rootNum = parseInt(m[1], 10);
	}
	if (rootNum < 0) {
		return { ok: false, motivo: 'revisão assinada sem /Root identificável' };
	}
	for (const m of trailing.matchAll(/\/Root\s+(\d+)\s+\d+\s+R\b/g)) {
		if (parseInt(m[1], 10) !== rootNum) {
			return { ok: false, motivo: 'incremental update troca o /Root do documento' };
		}
	}

	// Objetos definidos no trailing: ou são NOVOS (número >= próximo livre da
	// revisão assinada) ou são o catalog (Root) re-serializado com /DSS.
	const limite = proximoObjetoLivre(assinado);
	for (const m of trailing.matchAll(/(?:^|[\r\n])\s*(\d+)\s+\d+\s+obj\b/g)) {
		const num = parseInt(m[1], 10);
		if (num !== rootNum && num < limite) {
			return {
				ok: false,
				motivo: `incremental update redefine o objeto ${num} da revisão assinada`
			};
		}
	}

	// Catalog antes × depois: única mudança permitida é a entrada /DSS.
	try {
		const opts = { ignoreEncryption: true, updateMetadata: false } as const;
		const antes = await PDFDocument.load(pdfBytes.slice(0, fimAssinado), opts);
		const depois = await PDFDocument.load(pdfBytes, opts);
		const entradasAntes = new Map<string, string>();
		for (const [name, val] of antes.catalog.entries()) {
			entradasAntes.set(name.toString(), String(val));
		}
		for (const [name, val] of depois.catalog.entries()) {
			const chave = name.toString();
			if (chave === '/DSS') continue;
			if (entradasAntes.get(chave) !== String(val)) {
				return { ok: false, motivo: `incremental update altera a entrada ${chave} do catalog` };
			}
			entradasAntes.delete(chave);
		}
		entradasAntes.delete('/DSS');
		if (entradasAntes.size > 0) {
			return {
				ok: false,
				motivo: `incremental update remove entrada(s) do catalog: ${[...entradasAntes.keys()].join(', ')}`
			};
		}
	} catch (e) {
		return {
			ok: false,
			motivo: `não foi possível analisar o incremental update (${mensagemDeErro(e)})`
		};
	}

	return { ok: true };
}

/**
 * Verifica que o /ByteRange da assinatura cobre o documento INTEIRO:
 *   - começa no byte 0;
 *   - o gap entre os dois trechos é exatamente o placeholder /Contents
 *     (`<hex>` + whitespace);
 *   - termina no fim do arquivo — ou o que sobra é apenas um incremental
 *     update DSS legítimo (PAdES-LT) validado por `trailingEhDssLegitimo`.
 *
 * Sem isso, `verificarIntegridadePdf` confere o hash apenas dos trechos que o
 * PRÓPRIO PDF declara — um documento adulterado por conteúdo anexado após a
 * região assinada passaria como íntegro.
 */
export async function avaliarCoberturaAssinatura(
	pdfBytes: Uint8Array,
	byteRange: [number, number, number, number]
): Promise<{ ok: boolean; motivo?: string }> {
	const [a, b, c, d] = byteRange;
	if (a !== 0) {
		return { ok: false, motivo: `/ByteRange não inicia no byte 0 (inicia em ${a})` };
	}
	if (a + b > c || c + d > pdfBytes.length) {
		return { ok: false, motivo: '/ByteRange com trechos inconsistentes' };
	}

	// Gap [a+b, c) = exatamente o /Contents: '<' + hex/whitespace + '>' + whitespace.
	let pos = a + b;
	if (pdfBytes[pos] !== 0x3c /* '<' */) {
		return { ok: false, motivo: 'gap do /ByteRange não inicia no placeholder /Contents' };
	}
	pos++;
	while (pos < c && pdfBytes[pos] !== 0x3e /* '>' */) {
		const ch = pdfBytes[pos];
		const hex =
			(ch >= 0x30 && ch <= 0x39) || (ch >= 0x41 && ch <= 0x46) || (ch >= 0x61 && ch <= 0x66);
		const ws = ch === 0x20 || ch === 0x0a || ch === 0x0d || ch === 0x09;
		if (!hex && !ws) {
			return { ok: false, motivo: 'gap do /ByteRange contém bytes fora do placeholder hex' };
		}
		pos++;
	}
	if (pos >= c) {
		return { ok: false, motivo: 'placeholder /Contents sem ">" de fechamento dentro do gap' };
	}
	pos++; // consome '>'
	if (!bytesSaoWhitespace(pdfBytes.subarray(pos, c))) {
		return { ok: false, motivo: 'gap do /ByteRange contém bytes após o fechamento do /Contents' };
	}

	// Fim da cobertura: EOF exato, whitespace residual, ou DSS legítimo.
	const fim = c + d;
	if (fim === pdfBytes.length) return { ok: true };
	if (bytesSaoWhitespace(pdfBytes.subarray(fim))) return { ok: true };
	return trailingEhDssLegitimo(pdfBytes, fim);
}

// ---------------------------------------------------------------------------
// Helpers ASN.1
// ---------------------------------------------------------------------------

const uint8ToBinaryString = bytesToBinString;

interface CmsParsed {
	signedData: forge.asn1.Asn1;
	signerInfo: forge.asn1.Asn1;
	certificate: forge.pki.Certificate;
	certificateAsn1: forge.asn1.Asn1;
	/** Todos os certificados embutidos no SignedData (signatário + cadeia). */
	certificatesAsn1: forge.asn1.Asn1[];
	signedAttrs: forge.asn1.Asn1; // [0] IMPLICIT — para re-encode em SET
	signedAttrsAsSet: forge.asn1.Asn1; // mesma coisa, mas com tag SET (0x31)
	messageDigest: string; // bytes binários
	signatureValue: string; // bytes binários
	/** OID do signatureAlgorithm (SignerInfo.signatureAlgorithm). */
	sigAlgOid: string;
	/** OID do digestAlgorithm (SignerInfo.digestAlgorithm) — usado p/ rsaEncryption. */
	digestAlgOid?: string;
	signingTimeISO?: string;
	timestampToken?: forge.asn1.Asn1;
	/** OID da política de assinatura declarada (id-aa-ets-sigPolicyId). */
	sigPolicyOid?: string;
	/** sigPolicyHash (hex) embutido no atributo de política. */
	sigPolicyHashHex?: string;
}

/** Serial number normalizado (hex minúsculo, sem zeros à esquerda) para comparação. */
function serialNormalizado(hex: string): string {
	return hex.toLowerCase().replace(/^0+/, '') || '0';
}

/**
 * Localiza, entre os certificados embutidos, aquele que o `SignerInfo.sid`
 * aponta — por `issuerAndSerialNumber` ou por `subjectKeyIdentifier`.
 *
 * **Por que não basta `certificatesAsn1[0]`** (que era o que fazíamos): em DER,
 * `certificates` é um `SET OF`, e a ordem de um `SET OF` é definida pela
 * ORDENAÇÃO BYTE A BYTE da codificação de cada elemento — não pelo papel de
 * cada certificado. Quem diz qual deles assinou é o `sid`, e só ele. O próprio
 * caminho da TSA já reconhecia isso ("a folha pode não ser a primeira do SET") e
 * procurava o certificado certo por conta própria; o caminho do signatário
 * ficou com a suposição.
 *
 * Não era brecha — a assinatura é verificada CONTRA o certificado escolhido e a
 * cadeia é ancorada NELE, então errar o certificado reprova em vez de aceitar. O
 * defeito era o inverso: um CMS legítimo cuja folha não ordenasse primeiro seria
 * marcado como inválido no `/validar`.
 *
 * Devolve `null` quando o `sid` não é legível ou nenhum certificado casa — o
 * caller cai no primeiro do SET, que é o comportamento histórico e continua
 * seguro pelo mesmo motivo acima.
 */
function acharCertificadoDoSigner(
	certificatesAsn1: forge.asn1.Asn1[],
	sid: { issuerAndSerial?: forge.asn1.Asn1; ski?: string } | null
): { asn1: forge.asn1.Asn1; cert: forge.pki.Certificate } | null {
	if (!sid) return null;

	const parse = (asn1: forge.asn1.Asn1): forge.pki.Certificate | null => {
		try {
			return forge.pki.certificateFromAsn1(asn1);
		} catch {
			return null; // entrada que não é Certificate (CertificateChoices exótico)
		}
	};

	if (sid.issuerAndSerial) {
		let issuerDerAlvo: string;
		let serialAlvo: string;
		try {
			const partes = sid.issuerAndSerial.value as forge.asn1.Asn1[];
			issuerDerAlvo = forge.asn1.toDer(partes[0]).getBytes();
			serialAlvo = serialNormalizado(forge.util.bytesToHex(partes[1].value as string));
		} catch {
			return null;
		}
		for (const asn1 of certificatesAsn1) {
			const ident = issuerESerialDoCertAsn1(asn1);
			if (!ident) continue;
			if (ident.issuerDer !== issuerDerAlvo) continue;
			if (serialNormalizado(ident.serialHex) !== serialAlvo) continue;
			const cert = parse(asn1);
			return cert ? { asn1, cert } : null;
		}
		return null;
	}

	if (sid.ski) {
		const skiAlvo = forge.util.bytesToHex(sid.ski);
		for (const asn1 of certificatesAsn1) {
			const cert = parse(asn1);
			if (!cert) continue;
			const ext = cert.getExtension('subjectKeyIdentifier') as {
				subjectKeyIdentifier?: string;
			} | null;
			// forge expõe o SKI em hex; o `sid` chega como bytes brutos.
			if (ext?.subjectKeyIdentifier === skiAlvo) return { asn1, cert };
		}
	}
	return null;
}

/**
 * Emissor (bytes DER) e número de série de um certificado, lidos DIRETO da
 * árvore ASN.1 dele — não do objeto `forge.pki.Certificate`.
 *
 * A diferença importa: `forge.pki.distinguishedNameToAsn1(cert.issuer)`
 * RECONSTRÓI o DN a partir dos campos já parseados, e a reconstrução pode
 * escolher outro tipo de string (`PrintableString` × `UTF8String`) que a
 * codificação original. Os bytes sairiam diferentes para o certificado CERTO, e
 * o casamento com o `sid` falharia silenciosamente. Aqui o nó vem do DER
 * original, então re-serializá-lo devolve exatamente os mesmos bytes.
 *
 * `TBSCertificate ::= SEQUENCE { [0] version OPTIONAL, serialNumber,
 * signature, issuer, ... }` — sem a `version` (v1) tudo desloca uma posição,
 * daí a detecção pelo `tagClass` do primeiro filho.
 */
function issuerESerialDoCertAsn1(
	certAsn1: forge.asn1.Asn1
): { issuerDer: string; serialHex: string } | null {
	try {
		const tbs = (certAsn1.value as forge.asn1.Asn1[])[0].value as forge.asn1.Asn1[];
		const i = tbs[0].tagClass === forge.asn1.Class.CONTEXT_SPECIFIC ? 1 : 0;
		return {
			serialHex: forge.util.bytesToHex(tbs[i].value as string),
			issuerDer: forge.asn1.toDer(tbs[i + 2]).getBytes()
		};
	} catch {
		return null;
	}
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
			} else if (f.tagClass === forge.asn1.Class.CONTEXT_SPECIFIC && (f.type as number) === 0) {
				certsImpl = f;
			}
		}
		if (!signerInfos) {
			logger.warn('[PDF-VERIFY] CMS sem signerInfos (SET universal ausente no SignedData)');
			return null;
		}
		const signerInfo = (signerInfos.value as forge.asn1.Asn1[])[0];
		if (!signerInfo) {
			logger.warn('[PDF-VERIFY] CMS com signerInfos vazio');
			return null;
		}

		// Todos os certificados embutidos. QUAL deles assinou é decidido abaixo,
		// pelo `sid` do SignerInfo — nunca pela posição no SET (ver
		// `acharCertificadoDoSigner`).
		if (!certsImpl) {
			logger.warn('[PDF-VERIFY] CMS sem certificados [0] IMPLICIT no SignedData');
			return null;
		}
		const certificatesAsn1 = certsImpl.value as forge.asn1.Asn1[];

		// SignerInfo: version, sid, digestAlgorithm, [0] signedAttrs?, signatureAlgorithm, signature, [1] unsignedAttrs?
		// signatureAlgorithm vem APÓS signedAttrs e ANTES do signatureValue.
		// Identificamos pela posição: o último SEQUENCE universal antes do
		// OCTETSTRING é o signatureAlgorithm.
		const si = signerInfo.value as forge.asn1.Asn1[];
		let signedAttrs: forge.asn1.Asn1 | null = null;
		let unsignedAttrs: forge.asn1.Asn1 | null = null;
		let signatureValue: string | null = null;
		let sigAlgOid = '1.2.840.113549.1.1.11'; // default sha256WithRSAEncryption
		let digestAlgOid: string | undefined;
		let sigAlgEncontrado: forge.asn1.Asn1 | null = null;
		let digestAlgEncontrado: forge.asn1.Asn1 | null = null;
		// `sid` (SignerIdentifier): quem assinou. `issuerAndSerialNumber` é o
		// PRIMEIRO SEQUENCE universal do SignerInfo; `subjectKeyIdentifier` é um
		// `[0] IMPLICIT OCTET STRING` — mesma tag do signedAttrs, e o que os
		// separa é ser primitivo (string) em vez de construído (array).
		let sidIssuerSerial: forge.asn1.Asn1 | null = null;
		let sidSki: string | null = null;
		for (const f of si) {
			if (
				f.tagClass === forge.asn1.Class.CONTEXT_SPECIFIC &&
				(f.type as number) === 0 &&
				Array.isArray(f.value)
			) {
				signedAttrs = f;
			} else if (
				f.tagClass === forge.asn1.Class.CONTEXT_SPECIFIC &&
				(f.type as number) === 0 &&
				typeof f.value === 'string' &&
				signedAttrs === null
			) {
				sidSki = f.value;
			} else if (f.tagClass === forge.asn1.Class.CONTEXT_SPECIFIC && (f.type as number) === 1) {
				unsignedAttrs = f;
			} else if (
				f.tagClass === forge.asn1.Class.UNIVERSAL &&
				f.type === forge.asn1.Type.SEQUENCE &&
				signatureValue === null
			) {
				// SEQUENCEs universais do SignerInfo: sid (IssuerAndSerialNumber),
				// digestAlgorithm (ANTES do signedAttrs [0]) e signatureAlgorithm
				// (DEPOIS, último antes do OCTETSTRING). Capturamos o PRIMEIRO antes
				// do signedAttrs como sid, o ÚLTIMO como digestAlgorithm e o seguinte
				// como signatureAlgorithm.
				if (signedAttrs === null) {
					if (sidIssuerSerial === null) sidIssuerSerial = f;
					digestAlgEncontrado = f;
				} else {
					sigAlgEncontrado = f;
				}
			} else if (
				f.tagClass === forge.asn1.Class.UNIVERSAL &&
				f.type === forge.asn1.Type.OCTETSTRING
			) {
				signatureValue = f.value as string;
			}
		}
		// Um SignerInfo com sid por issuerAndSerial tem DOIS SEQUENCEs antes do
		// signedAttrs (sid, digestAlgorithm). Se só houve um, ele É o
		// digestAlgorithm e o sid veio por SKI — não há issuerAndSerial a casar.
		if (sidIssuerSerial === digestAlgEncontrado) sidIssuerSerial = null;

		const doSigner = acharCertificadoDoSigner(certificatesAsn1, {
			issuerAndSerial: sidIssuerSerial ?? undefined,
			ski: sidSki ?? undefined
		});
		if (!doSigner) {
			logger.warn(
				'[PDF-VERIFY] SignerInfo.sid não casou com nenhum certificado embutido — usando o primeiro do SET',
				{ temIssuerSerial: !!sidIssuerSerial, temSki: !!sidSki, certs: certificatesAsn1.length }
			);
		}
		const certificateAsn1 = doSigner?.asn1 ?? certificatesAsn1[0];
		const certificate = doSigner?.cert ?? forge.pki.certificateFromAsn1(certificateAsn1);
		if (!signedAttrs || !signatureValue) {
			logger.warn(
				'[PDF-VERIFY] CMS sem signedAttrs ([0]) ou signatureValue (OCTET STRING) no SignerInfo',
				{
					temSignedAttrs: !!signedAttrs,
					temSignatureValue: !!signatureValue
				}
			);
			return null;
		}
		if (sigAlgEncontrado) {
			try {
				const oidBytes = (sigAlgEncontrado.value as forge.asn1.Asn1[])[0].value as string;
				sigAlgOid = forge.asn1.derToOid(oidBytes);
			} catch {
				/* mantém default */
			}
		}
		if (digestAlgEncontrado) {
			try {
				const oidBytes = (digestAlgEncontrado.value as forge.asn1.Asn1[])[0].value as string;
				digestAlgOid = forge.asn1.derToOid(oidBytes);
			} catch {
				/* digestAlgOid permanece undefined */
			}
		}

		// Re-codifica signedAttrs como SET (tag 0x31) — a assinatura é sobre essa forma.
		const signedAttrsAsSet = forge.asn1.create(
			forge.asn1.Class.UNIVERSAL,
			forge.asn1.Type.SET,
			true,
			signedAttrs.value as forge.asn1.Asn1[]
		);

		// Extrai messageDigest, signingTime e a política dos SignedAttributes.
		let messageDigest = '';
		let signingTimeISO: string | undefined;
		let sigPolicyOid: string | undefined;
		let sigPolicyHashHex: string | undefined;
		for (const attr of signedAttrs.value as forge.asn1.Asn1[]) {
			const filhos = attr.value as forge.asn1.Asn1[];
			const oidBytes = filhos[0].value as string;
			const oid = forge.asn1.derToOid(oidBytes);
			const setVal = filhos[1].value as forge.asn1.Asn1[];
			if (oid === OID_MESSAGE_DIGEST) {
				messageDigest = setVal[0].value as string;
			} else if (oid === OID_SIG_POLICY_ID) {
				// SignaturePolicyId ::= SEQUENCE {
				//   sigPolicyId OID,
				//   sigPolicyHash SEQUENCE { AlgorithmIdentifier, OCTET STRING hash } }
				try {
					const spid = setVal[0].value as forge.asn1.Asn1[];
					sigPolicyOid = forge.asn1.derToOid(spid[0].value as string);
					const sigHashSeq = spid[1].value as forge.asn1.Asn1[];
					sigPolicyHashHex = forge.util.bytesToHex(sigHashSeq[1].value as string);
				} catch {
					/* atributo presente mas malformado — fica não-conforme */
					sigPolicyOid = sigPolicyOid ?? 'malformado';
				}
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
			certificatesAsn1,
			signedAttrs,
			signedAttrsAsSet,
			messageDigest,
			signatureValue,
			sigAlgOid,
			digestAlgOid,
			signingTimeISO,
			timestampToken,
			sigPolicyOid,
			sigPolicyHashHex
		};
	} catch (e) {
		logger.warn('[PDF-VERIFY] Falha ao parsear CMS', {
			error: mensagemDeErro(e)
		});
		return null;
	}
}

// ---------------------------------------------------------------------------
// Verificações individuais
// ---------------------------------------------------------------------------

/**
 * O conteúdo assinado bate com o `messageDigest` dos SignedAttributes?
 *
 * É O vínculo que transforma "existe uma assinatura válida" em "esta assinatura
 * é DESTE documento". Sem ele, uma assinatura legítima sobre os SignedAttributes
 * de OUTRO documento passaria — a verificação de `crypto-verify` cobre os
 * atributos, não os bytes do PDF.
 *
 * `digestAlgOid` é o `digestAlgorithm` do SignerInfo, e precisa ser o MESMO que o
 * assinador usou: o hash era fixo em SHA-256 aqui, enquanto `crypto-verify`
 * aceita SHA-384 e SHA-512 e `avaliarPoliticaCriptografica` só barra SHA-1.
 * Documento assinado com SHA-384/512 tinha, então, `assinaturaRsa: true` e
 * `integridade: false` — e o veredito saía como "Hash do conteúdo do PDF não
 * confere", isto é, o portal `/validar` ACUSANDO DE ADULTERAÇÃO um documento
 * autêntico. Falha fechada, mas a consequência é jurídica, não técnica.
 *
 * `undefined` cai em SHA-256 de propósito, e são dois casos legítimos: o selo
 * institucional (que o próprio servidor gera em SHA-256) e o CMS legado cujo
 * `digestAlgorithm` o parser não conseguiu ler. A conferência de comprimento
 * abaixo continua sendo a rede: OID que não reconhecemos não vira "passou".
 */
export async function verificarIntegridadePdf(
	bytesAssinados: Uint8Array,
	expectedDigestBytes: string,
	digestAlgOid?: string
): Promise<boolean> {
	const hash = await crypto.subtle.digest(
		nomeDigestPorOid(digestAlgOid),
		bytesAssinados as unknown as ArrayBuffer
	);
	const arr = new Uint8Array(hash);
	if (arr.length !== expectedDigestBytes.length) return false;
	let diff = 0;
	for (let i = 0; i < arr.length; i++) {
		diff |= arr[i] ^ (expectedDigestBytes.charCodeAt(i) & 0xff);
	}
	return diff === 0;
}

/**
 * Verifica a assinatura do SignerInfo respeitando o `sigAlgOid` extraído
 * do CMS — suporta RSA PKCS#1 v1.5, RSA-PSS e ECDSA.
 *
 * Deve ser preferida em todo código novo.
 */
export async function verificarAssinaturaCmsAsync(
	cert: forge.pki.Certificate,
	sigAlgOid: string,
	signedAttrsAsSet: forge.asn1.Asn1,
	signatureValue: string,
	digestAlgOid?: string
): Promise<boolean> {
	return verificarAssinaturaCms({
		cert,
		sigAlgOid,
		signedAttrsAsSet,
		signatureValue,
		digestAlgOid
	});
}

/**
 * Política criptográfica mínima do certificado/assinatura do SIGNATÁRIO:
 *   - rejeita SHA-1 (colisões práticas desde 2017 — uma assinatura "válida"
 *     com SHA-1 não sustenta não-repúdio);
 *   - exige RSA ≥ 2048 bits (DOC-ICP-01 não emite menos desde 2012);
 *   - exige keyUsage com digitalSignature ou nonRepudiation (um cert ICP
 *     emitido só para keyEncipherment/autenticação não é cert de assinatura).
 *
 * NÃO se aplica ao CertID do OCSP (RFC 6960 usa SHA-1 por especificação) nem
 * à TSA (validada à parte, com EKU timeStamping crítica).
 */
export function avaliarPoliticaCriptografica(
	sigAlgOid: string,
	digestAlgOid: string | undefined,
	cert: forge.pki.Certificate
): { ok: boolean; motivo?: string } {
	if (
		sigAlgOid === SIGNATURE_OIDS.SHA1_RSA ||
		(sigAlgOid === SIGNATURE_OIDS.RSA_ENCRYPTION && digestAlgOid === DIGEST_OIDS.SHA1)
	) {
		return { ok: false, motivo: 'assinatura usa SHA-1 (algoritmo quebrado — mínimo SHA-256)' };
	}
	// Chave RSA: forge expõe o módulo em `n`. Chaves EC não têm `n` (a curva
	// já é validada na verificação — P-256/384/521 apenas).
	const pub = cert.publicKey as { n?: { bitLength(): number } } | undefined;
	if (pub?.n) {
		const bits = pub.n.bitLength();
		if (bits < 2048) {
			return { ok: false, motivo: `chave RSA de ${bits} bits (mínimo 2048)` };
		}
	}
	const ku = cert.getExtension('keyUsage') as {
		digitalSignature?: boolean;
		nonRepudiation?: boolean;
	} | null;
	if (!ku || (!ku.digitalSignature && !ku.nonRepudiation)) {
		return {
			ok: false,
			motivo: 'certificado sem keyUsage de assinatura (digitalSignature/nonRepudiation)'
		};
	}
	return { ok: true };
}

/**
 * Valida a cadeia do certificado contra o trust store da ICP-Brasil.
 *
 * Três respostas, e a terceira é o ponto: `'indisponivel'` significa que o trust
 * store não foi carregado no ambiente — não é reprovação. Quem chama decide se
 * aceita com aviso ou recusa (`ICP_BRASIL_TRUST_STORE_REQUIRED`); reduzir isso a
 * `false` diria que o certificado é inválido quando o que falta é a nossa lista
 * de ACs.
 *
 * `dataReferencia` deve ser o instante do CARIMBO DE TEMPO qualificado, não
 * "agora": a assinatura foi feita com o certificado válido, e um e-CPF expira em
 * 1–3 anos. Validando em "agora", toda assinatura antiga passaria a reprovar
 * sozinha com o tempo — exatamente o que o carimbo CAdES-T/PAdES-LT existe para
 * evitar.
 */
export function verificarCadeiaIcpBrasil(
	cert: forge.pki.Certificate,
	dataReferencia?: Date
): boolean | 'indisponivel' {
	const ts = loadTrustStore();
	if (!ts.disponivel) return 'indisponivel';
	try {
		// forge.pki.verifyCertificateChain aceita um array começando pelo end-entity.
		// Sem intermediárias explícitas no CMS, dependemos de o caStore conter todas as
		// ACs (raízes + intermediárias) — modelo "trust store completo".
		//
		// `validityCheckDate`: valida a cadeia no instante do carimbo de tempo
		// qualificado (quando disponível), não em "agora". Sem isso, a página
		// /validar passaria a reprovar a cadeia assim que o e-CPF expirasse (A1
		// ≈ 1 ano, A3 ≈ 3 anos), apesar de a assinatura ter sido feita com o
		// certificado válido e carimbada por ACT (CAdES-T/PAdES-LT). Fallback
		// para "agora" quando não há TST disponível.
		return forge.pki.verifyCertificateChain(ts.caStore, [cert], {
			validityCheckDate: dataReferencia ?? new Date()
		});
	} catch (e) {
		logger.info('[PDF-VERIFY] Cadeia ICP-Brasil inválida', {
			subject: cert.subject.getField('CN')?.value,
			error: mensagemDeErro(e)
		});
		return false;
	}
}

/** EKU `timeStamping` marcada como crítica (RFC 3161 §2.3 — obrigatória em ACTs). */
function temEkuTimeStampingCritica(cert: forge.pki.Certificate): boolean {
	const eku = cert.extensions?.find((e) => e.name === 'extKeyUsage') as
		{ critical?: boolean; timeStamping?: boolean } | undefined;
	return !!(eku && eku.critical && eku.timeStamping);
}

/**
 * Valida a cadeia de uma TSA (carimbo de tempo) contra o trust store ICP-Brasil.
 *
 * Difere de `verificarCadeiaIcpBrasil` num único ponto: tolera a extensão
 * `extKeyUsage` (EKU) marcada como CRÍTICA quando contém `timeStamping`. A
 * RFC 3161 §2.3 EXIGE que a EKU da ACT seja crítica e contenha apenas
 * id-kp-timeStamping; node-forge, porém, não a reconhece como "suportada" e
 * abortaria toda a validação com `forge.pki.UnsupportedCertificate`. A
 * tolerância é estreita — só se aplica a certificados que realmente têm a EKU
 * timeStamping crítica, de modo que certificados comuns seguem a checagem
 * padrão de extensões críticas.
 */
function verificarCadeiaTsa(
	cert: forge.pki.Certificate,
	dataReferencia?: Date
): boolean | 'indisponivel' {
	const ts = loadTrustStore();
	if (!ts.disponivel) return 'indisponivel';
	try {
		return forge.pki.verifyCertificateChain(ts.caStore, [cert], {
			validityCheckDate: dataReferencia ?? new Date(),
			verify: (vfd: boolean | string, depth: number, chain: forge.pki.Certificate[]): boolean => {
				if (vfd === true) return true;
				// Tolera SOMENTE a EKU timeStamping crítica (esperada em ACTs); qualquer
				// outra falha de cadeia/extensão é rejeitada normalmente.
				if (vfd === 'forge.pki.UnsupportedCertificate' && temEkuTimeStampingCritica(chain[depth])) {
					return true;
				}
				return false;
			}
		}) as boolean;
	} catch (e) {
		logger.info('[PDF-VERIFY] Cadeia TSA inválida', {
			subject: cert.subject.getField('CN')?.value,
			error: mensagemDeErro(e)
		});
		return false;
	}
}

/** Seleciona o algoritmo de digest a partir do OID (default SHA-256). */
/**
 * Nome Web Crypto do digest a partir do OID do `digestAlgorithm`.
 *
 * FONTE ÚNICA da resposta "qual hash este SignerInfo usou": `mdPorOid` (forge,
 * para o caminho da TSA) deriva daqui, e `verificarIntegridadePdf` usa o nome
 * direto. Enquanto eram dois `switch`, o da TSA respeitava SHA-384/512 e o da
 * integridade do documento estava fixo em SHA-256 — a divergência que fazia o
 * `/validar` acusar de adulteração um PDF assinado com SHA-384.
 *
 * Desconhecido e ausente caem em SHA-256, que é o obrigatório da ICP-Brasil
 * (DOC-ICP-15.03) e o que o selo institucional emite. SHA-1 não precisa de caso
 * próprio: `avaliarPoliticaCriptografica` já reprova a assinatura antes.
 */
function nomeDigestPorOid(oid?: string): 'SHA-256' | 'SHA-384' | 'SHA-512' {
	switch (oid) {
		case DIGEST_OIDS.SHA384:
			return 'SHA-384';
		case DIGEST_OIDS.SHA512:
			return 'SHA-512';
		default:
			return 'SHA-256';
	}
}

function mdPorOid(oid?: string): forge.md.MessageDigest {
	switch (nomeDigestPorOid(oid)) {
		case 'SHA-384':
			return forge.md.sha384.create();
		case 'SHA-512':
			return forge.md.sha512.create();
		default:
			return forge.md.sha256.create();
	}
}

/** Compara dois byte-strings em tempo ~constante. */
function bytesIguais(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return diff === 0;
}

export interface TstVerificado {
	/** ISO 8601 do `genTime` do carimbo. */
	momento: string;
	/**
	 * Origem do carimbo, após verificação criptográfica completa:
	 *
	 *   - `'icp'`     — a TSA encadeia até uma AC Raiz da ICP-Brasil. Tem
	 *                   tempestividade oponível a terceiros (art. 10 §1º da
	 *                   MP 2.200-2/2001, DOC-ICP-15).
	 *   - `'externa'` — a assinatura do carimbo é válida, mas a TSA NÃO é
	 *                   ICP-Brasil (ex.: DigiCert) OU o trust store está
	 *                   indisponível. Carimbo real, porém sem a presunção ICP.
	 */
	classe: 'icp' | 'externa';
}

/**
 * Verifica criptograficamente um TimeStampToken RFC 3161 e classifica a TSA.
 *
 * Um TST é, em si, um CMS SignedData — então reaproveitamos `parseCms` e
 * `verificarAssinaturaCmsAsync` em vez de reimplementar criptografia. As três
 * checagens abaixo são TODAS obrigatórias para retornar não-nulo:
 *
 *   1. `messageImprint` do TSTInfo == hash(signatureValue) — liga o carimbo
 *      à NOSSA assinatura (a que estamos verificando).
 *   2. `messageDigest` assinado == hash(TSTInfo) — garante que a assinatura
 *      da TSA cobre exatamente o TSTInfo de onde lemos genTime/messageImprint
 *      (sem isso, um atacante poderia trocar o eContent mantendo a assinatura).
 *   3. assinatura da TSA sobre os SignedAttributes confere (RSA/ECDSA), usando
 *      o certificado da própria TSA embutido no token.
 *
 * Só então valida a cadeia da TSA no instante do `genTime`, classificando como
 * `'icp'` (encadeia até ICP-Brasil) ou `'externa'` (válida, mas não-ICP).
 *
 * Retorna `null` se QUALQUER checagem cripto (1-3) falhar — o caller deve
 * tratar como token inválido (rejeitar a finalização / marcar erro na /validar).
 * Cadeia não-ICP NÃO produz `null`: produz `'externa'`.
 */
export async function verificarTimestampToken(
	tstWrapper: forge.asn1.Asn1,
	signatureValue: string
): Promise<TstVerificado | null> {
	try {
		// O TST (ContentInfo) é um CMS — reusa o parser do CMS principal.
		const tstDerStr = forge.asn1.toDer(tstWrapper).getBytes();
		const tstDer = binStringToBytes(tstDerStr);
		const parsed = parseCms(tstDer);
		if (!parsed) return null;

		// encapContentInfo (sd[2]): SEQUENCE { eContentType, [0] EXPLICIT OCTET STRING TSTInfo }
		const sd = parsed.signedData.value as forge.asn1.Asn1[];
		const encap = sd[2];
		const encapChildren = encap.value as forge.asn1.Asn1[];
		const encapWrap = encapChildren[1];
		const tstInfoOctet = (encapWrap.value as forge.asn1.Asn1[])[0];
		const tstInfoDer = tstInfoOctet.value as string;
		const tstInfo = forge.asn1.fromDer(tstInfoDer);
		const ti = tstInfo.value as forge.asn1.Asn1[];

		// TSTInfo: version, policy, messageImprint, serialNumber, genTime, ...
		// messageImprint: SEQUENCE { AlgorithmIdentifier, OCTET STRING hash }
		const messageImprint = ti[2];
		const miChildren = messageImprint.value as forge.asn1.Asn1[];
		let miAlgOid: string | undefined;
		try {
			miAlgOid = forge.asn1.derToOid((miChildren[0].value as forge.asn1.Asn1[])[0].value as string);
		} catch {
			/* default SHA-256 */
		}
		const miHash = miChildren[1].value as string;

		// genTime (GeneralizedTime).
		let genTimeISO: string | null = null;
		let genTimeDate: Date | undefined;
		for (let i = 3; i < ti.length; i++) {
			if (ti[i].type === forge.asn1.Type.GENERALIZEDTIME) {
				try {
					genTimeDate = forge.asn1.generalizedTimeToDate(ti[i].value as string);
					genTimeISO = genTimeDate.toISOString();
				} catch {
					/* ignore */
				}
				break;
			}
		}
		if (!genTimeISO) return null;

		// (1) messageImprint == hash(signatureValue), no algoritmo do imprint.
		const mdImprint = mdPorOid(miAlgOid);
		mdImprint.update(signatureValue);
		if (!bytesIguais(mdImprint.digest().getBytes(), miHash)) return null;

		// (2) messageDigest assinado == hash(TSTInfo), no digestAlgorithm do SignerInfo.
		const mdContent = mdPorOid(parsed.digestAlgOid);
		mdContent.update(tstInfoDer);
		if (!bytesIguais(mdContent.digest().getBytes(), parsed.messageDigest)) return null;

		// (3) assinatura da TSA — tenta cada cert do token até um validar (a folha
		//     nem sempre é a primeira do SET de certificados).
		let tsaCert: forge.pki.Certificate | null = null;
		for (const certAsn1 of parsed.certificatesAsn1) {
			let cert: forge.pki.Certificate;
			try {
				cert = forge.pki.certificateFromAsn1(certAsn1);
			} catch {
				continue;
			}
			const ok = await verificarAssinaturaCmsAsync(
				cert,
				parsed.sigAlgOid,
				parsed.signedAttrsAsSet,
				parsed.signatureValue,
				parsed.digestAlgOid
			);
			if (ok) {
				tsaCert = cert;
				break;
			}
		}
		if (!tsaCert) return null;

		// Cadeia da TSA no instante do carimbo → classifica ICP vs externa.
		const cadeia = verificarCadeiaTsa(tsaCert, genTimeDate);
		return { momento: genTimeISO, classe: cadeia === true ? 'icp' : 'externa' };
	} catch (e) {
		logger.warn('[PDF-VERIFY] Falha ao verificar TimeStampToken', {
			error: mensagemDeErro(e)
		});
		return null;
	}
}

// ---------------------------------------------------------------------------
// Orquestrador
// ---------------------------------------------------------------------------

interface VerifyOptions {
	/** Snapshot OCSP previamente armazenado (CAdES-LT). */
	ocspSnapshotB64?: string | null;
	/**
	 * `platform.env` para checar `ICP_BRASIL_TRUST_STORE_REQUIRED`. Quando
	 * essa env está ligada e o trust store está vazio, devolvemos
	 * `valid: false` em vez de aceitar com warning — assim a página /validar
	 * deixa claro que a cadeia não pôde ser validada.
	 */
	env?: Record<string, string | undefined>;
}

/**
 * Verificação completa da assinatura do PDF — o que a página pública `/validar`
 * mostra em forma de checklist.
 *
 * Confere, de forma independente: INTEGRIDADE (o digest do conteúdo bate),
 * ASSINATURA RSA (o CMS fecha com a chave do certificado), CADEIA ICP-Brasil,
 * CARIMBO DE TEMPO qualificado, REVOGAÇÃO (OCSP) e COBERTURA do `/ByteRange`.
 *
 * Cada item é devolvido em `checks`, e os problemas em `erros`, em vez de lançar:
 * a tela precisa dizer O QUE falhou, item por item.
 *
 * O `valid` consolidado NÃO é a conjunção ingênua dos checks:
 * - exige integridade, cobertura do ByteRange, assinatura RSA, política
 *   criptográfica e cadeia;
 * - o CARIMBO DE TEMPO é reportado mas não exigido — sem ele a assinatura é
 *   válida e não qualificada, distinção que a tela mostra;
 * - `revogacao === 'unknown'` (OCSP fora do ar, sem snapshot) não invalida:
 *   indisponibilidade de terceiro não é prova de revogação. Só `'revoked'`
 *   reprova, ou um snapshot que não se possa confiar;
 * - cadeia `'indisponivel'` conta como ok por padrão (trust store em
 *   implantação) e reprova com `ICP_BRASIL_TRUST_STORE_REQUIRED=true`.
 */
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
			revogacao: 'unknown',
			revogacaoAssinaturaResponder: 'nao_verificada',
			cobertura: false
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
		// Mesma extração usada na preparação/finalização da assinatura — a cópia
		// local que existia aqui usava `getField('serialNumber')`, que devolve null
		// no node-forge, e por isso mostrava CPF vazio para e-CPF cujo CN não
		// embute ":CPF".
		const { nome, cpf } = extrairDadosDoCertificado(cms.certificate);

		result.certificado = {
			nome,
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
		cms.messageDigest,
		cms.digestAlgOid
	);
	if (!result.checks.integridade) {
		erros.push('Hash do conteúdo do PDF não confere com o messageDigest assinado');
	}

	// 1b. Cobertura do /ByteRange — o hash acima só prova integridade dos
	//     trechos que o próprio PDF declara; aqui garantimos que esses trechos
	//     cobrem o arquivo inteiro (tolerando apenas DSS incremental legítimo).
	const cobertura = await avaliarCoberturaAssinatura(pdfBytes, extracao.byteRange);
	result.checks.cobertura = cobertura.ok;
	if (!cobertura.ok) {
		erros.push(
			`Assinatura não cobre o documento completo — possível conteúdo adicionado após a assinatura (${cobertura.motivo})`
		);
	}

	// 2. Assinatura do SignerInfo (RSA PKCS#1, RSA-PSS ou ECDSA conforme sigAlgOid).
	result.checks.assinaturaRsa = await verificarAssinaturaCmsAsync(
		cms.certificate,
		cms.sigAlgOid,
		cms.signedAttrsAsSet,
		cms.signatureValue,
		cms.digestAlgOid
	);
	if (!result.checks.assinaturaRsa) {
		erros.push('Assinatura criptográfica dos SignedAttributes inválida');
	}

	// 2b. Política criptográfica mínima (SHA-1, RSA < 2048, keyUsage) — uma
	//     assinatura matematicamente válida com algoritmo/chave fracos não
	//     sustenta a classificação de qualificada.
	const politicaCripto = avaliarPoliticaCriptografica(
		cms.sigAlgOid,
		cms.digestAlgOid,
		cms.certificate
	);
	if (!politicaCripto.ok) {
		erros.push(`Política criptográfica violada: ${politicaCripto.motivo}`);
	}

	// 3. Carimbo de tempo qualificado — determinado ANTES da cadeia porque
	//    serve de data de referência para validar a validade do certificado no
	//    instante da assinatura (e não em "agora").
	if (cms.timestampToken) {
		const tst = await verificarTimestampToken(cms.timestampToken, cms.signatureValue);
		if (tst) {
			// "Qualificado" só quando a TSA encadeia até a ICP-Brasil; um carimbo
			// de TSA externa (ex.: DigiCert) é válido, porém não-qualificado.
			result.checks.timestampQualificado = tst.classe === 'icp';
			result.timestamp = {
				tipo: tst.classe === 'icp' ? 'act_icp' : 'tsa_externa',
				momento: tst.momento
			};
		} else {
			erros.push('Token TSA presente mas inválido (assinatura ou messageImprint não conferem)');
			result.timestamp = { tipo: 'servidor', momento: cms.signingTimeISO ?? '' };
		}
	} else if (cms.signingTimeISO) {
		result.timestamp = { tipo: 'servidor', momento: cms.signingTimeISO };
	}

	// Política de assinatura (id-aa-ets-sigPolicyId) — informativo: confere se a
	// referência embutida é a PA-AD-RB v2.3 oficial (OID + sigPolicyHash). Não
	// entra no `valid` (assinaturas antigas com hash placeholder não devem ser
	// reprovadas); o cumprimento PLENO é atestado pelo Validador ITI.
	result.politica = avaliarPoliticaAssinatura(cms.sigPolicyOid, cms.sigPolicyHashHex);

	// Data de referência p/ a cadeia: instante do carimbo (TST oponível a
	// terceiros quando 'act_icp'; signingTime assinado caso contrário). Sem
	// momento disponível, cai para "agora" dentro de verificarCadeiaIcpBrasil.
	let dataReferenciaCadeia: Date | undefined;
	if (result.timestamp?.momento) {
		const d = new Date(result.timestamp.momento);
		if (!isNaN(d.getTime())) dataReferenciaCadeia = d;
	}

	// 4. Cadeia ICP-Brasil — validada na data de referência, preservando a
	//    validade probatória de longo prazo após a expiração do e-CPF (A1).
	const cadeia = verificarCadeiaIcpBrasil(cms.certificate, dataReferenciaCadeia);
	result.checks.cadeiaIcpBrasil = cadeia;
	if (cadeia === false) {
		erros.push('Certificado não encadeia até uma AC Raiz da ICP-Brasil reconhecida');
	}

	// 5. Revogação (snapshot OCSP) — revalida a assinatura do responder contra o
	//    issuer (defesa anti-MITM também na re-verificação, não só no momento da
	//    assinatura). Localiza o issuer no trust store pelo CN; sem ele,
	//    statusDeSnapshot devolve apenas o status (compat com snapshots antigos).
	let ocspNaoConfiavel = false;
	if (options.ocspSnapshotB64) {
		let issuerCert: forge.pki.Certificate | undefined;
		try {
			issuerCert = encontrarIssuerNoTrustStore(cms.certificate, loadTrustStore());
		} catch {
			/* sem issuer disponível — segue só com o status do snapshot */
		}
		const snap = statusDeSnapshot(options.ocspSnapshotB64, issuerCert);
		result.checks.revogacao = snap.status;
		result.checks.revogacaoAssinaturaResponder = snap.assinaturaResponder ?? 'nao_verificada';
		if (snap.status === 'revoked') {
			erros.push(
				`Certificado REVOGADO${snap.revokedAt ? ` em ${snap.revokedAt}` : ''} (snapshot OCSP)`
			);
		} else if (snap.assinaturaResponder === 'invalida') {
			// Falha dura: snapshot adulterado/forjado não pode sustentar "good".
			ocspNaoConfiavel = true;
			erros.push(
				'Assinatura do responder OCSP não confere no snapshot — status de revogação não confiável (possível adulteração ou MITM).'
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

	// 7. Multi-signature: valida CADA assinatura anterior à atual (workflow
	//    em que OIP assina, depois DPC assina por cima). Hoje validamos só a
	//    última; aqui resumimos as anteriores para que a UI possa mostrar e
	//    o orquestrador possa rejeitar PDFs com assinaturas corrompidas no
	//    meio (sinal de adulteração).
	try {
		const todas = extrairTodasCmsDoPdf(pdfBytes);
		if (todas.length > 1) {
			const adicionais: NonNullable<VerificationResult['assinaturasAdicionais']> = [];
			const principal = indiceAssinaturaPrincipal(todas);
			// Itera todas EXCETO a principal (já validada acima).
			for (let i = 0; i < todas.length; i++) {
				if (i === principal) continue;
				const t = todas[i];
				const cmsAnt = parseCms(t.cmsDer);
				if (!cmsAnt) {
					adicionais.push({
						ordem: i,
						signerCN: '<malformado>',
						serial: '',
						integridade: false,
						assinaturaRsa: false
					});
					continue;
				}
				// O `digestAlgOid` vai aqui também, e não só na verificação de assinatura
				// duas linhas abaixo: era a segunda cópia da chamada fixa em SHA-256, e uma
				// co-assinatura em SHA-384 sairia como "Assinatura adicional inválida".
				const integOk = await verificarIntegridadePdf(
					t.bytesAssinados,
					cmsAnt.messageDigest,
					cmsAnt.digestAlgOid
				);
				const rsaOk = await verificarAssinaturaCmsAsync(
					cmsAnt.certificate,
					cmsAnt.sigAlgOid,
					cmsAnt.signedAttrsAsSet,
					cmsAnt.signatureValue,
					cmsAnt.digestAlgOid
				);
				adicionais.push({
					ordem: i,
					signerCN: (cmsAnt.certificate.subject.getField('CN')?.value as string) || '',
					serial: cmsAnt.certificate.serialNumber,
					integridade: integOk,
					assinaturaRsa: rsaOk
				});
				if (!integOk || !rsaOk) {
					erros.push(
						`Assinatura adicional #${i + 1} inválida (integridade=${integOk}, rsa=${rsaOk})`
					);
				}
			}
			if (adicionais.length > 0) {
				result.assinaturasAdicionais = adicionais;
			}
		}
	} catch {
		/* falha aqui não invalida a principal — apenas omite o resumo das anteriores */
	}

	// Resultado consolidado: válido apenas se TODOS os checks essenciais passaram.
	//
	// Política de cadeia "indisponivel":
	//   - default: trata como ok (legado, trust store em fase de implantação)
	//   - com ICP_BRASIL_TRUST_STORE_REQUIRED=true: trata como inválido (não
	//     dá pra afirmar que é qualificada sem validar a cadeia).
	const cadeiaOk =
		cadeia === true || (cadeia === 'indisponivel' && !trustStoreRequerido(options.env));
	if (cadeia === 'indisponivel' && trustStoreRequerido(options.env)) {
		erros.push(
			'Trust store ICP-Brasil não populado neste servidor — não foi possível validar a cadeia.'
		);
	}
	result.valid =
		result.checks.integridade &&
		result.checks.cobertura &&
		result.checks.assinaturaRsa &&
		politicaCripto.ok &&
		cadeiaOk &&
		result.checks.revogacao !== 'revoked' &&
		!ocspNaoConfiavel;

	return result;
}
