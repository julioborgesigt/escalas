import { PDFDocument, StandardFonts, rgb, degrees, type PDFPage, type PDFFont } from 'pdf-lib';
import { pdflibAddPlaceholder } from '@signpdf/placeholder-pdf-lib';
import { removeTrailingNewLine } from '@signpdf/utils';
import forge from 'node-forge';
import * as QRCode from 'qrcode';
import { logger } from './logger';
import { bytesToHex } from '$lib/crypto/hex';
// Identidade da política (OIDs, hash oficial, resolver) — fonte única
// compartilhada com a verificação, sem deps pesadas.
import { OID_SIG_POLICY_ID, OID_PA_AD_RB_V2_3, resolverHashPolitica } from './icp-policy';

/**
 * Tamanho do placeholder de /Contents, em CARACTERES HEX ⇒ capacidade real de
 * CMS = METADE em bytes. 32768 hex chars = 16 KB de CMS.
 *
 * Casos a acomodar:
 *   - Qualificada (SERPRO): CMS com a cadeia ICP-Brasil (~6-8 KB). NÃO anexamos
 *     TST server-side a ele (re-codificar o CMS BER do SERPRO invalida a
 *     assinatura — vide cades-finalizer e embedSerproCms), então não há TST a somar.
 *   - Avançada (selo institucional autoassinado): CMS de 1 cert (~2 KB) +
 *     TimeStampToken RFC 3161 (~5 KB), pois esse CMS é gerado por nós em DER e
 *     pode ser re-serializado com segurança.
 *
 * 16 KB dão folga confortável para ambos. (NÃO usar 8 KB: a avançada+TST fica no
 * limite; NÃO precisar de 32 KB: o SERPRO não recebe TST server-side.)
 *
 * IMPORTANTE: mudar este valor só afeta NOVOS PDFs preparados. PDFs antigos
 * permanecem com placeholder do tamanho original.
 */
const SIGNATURE_LENGTH = 32768;
const BYTE_RANGE_PLACEHOLDER = '********** ********** **********';

// OIDs usados na estrutura CMS
const OID_DATA = '1.2.840.113549.1.7.1';
const OID_SIGNED_DATA = '1.2.840.113549.1.7.2';
const OID_CONTENT_TYPE = '1.2.840.113549.1.9.3';
const OID_SIGNING_TIME = '1.2.840.113549.1.9.5';
const OID_MESSAGE_DIGEST = '1.2.840.113549.1.9.4';
const OID_SHA256 = '2.16.840.1.101.3.4.2.1';

// ---------------------------------------------------------------------------
// UTILITÁRIOS DE VALIDAÇÃO E CERTIFICADOS
// ---------------------------------------------------------------------------

/**
 * Extrai Nome e CPF de uma assinatura CMS (Base64).
 */
export function extrairDadosCertificado(cmsBase64: string): { nome: string; cpf: string } {
	try {
		const der = forge.util.decode64(cmsBase64);
		const asn1 = forge.asn1.fromDer(der);
		const p7 = forge.pkcs7.messageFromAsn1(asn1);

		// O certificado do assinante geralmente é o primeiro da lista
		const cert = (p7 as unknown as { certificates: forge.pki.Certificate[] }).certificates[0];
		if (!cert) throw new Error('Certificado não encontrado no CMS');

		return extrairDadosDoCertificado(cert);
	} catch (e) {
		logger.error('[PDF-SIGN] Erro ao extrair dados do certificado', {
			error: e instanceof Error ? e.message : String(e)
		});
		throw new Error('Falha ao processar o certificado digital do Token.', { cause: e });
	}
}

/**
 * Extrai Nome e CPF de um certificado ICP-Brasil já parseado (forge).
 *
 * Separado de `extrairDadosCertificado` para que callers que já têm o
 * certificado parseado reusem a MESMA lógica sem reparsear o CMS — em especial
 * o login por Token A3, que verifica criptograficamente a assinatura ANTES de
 * confiar na identidade do subject (a extração tem de incidir sobre exatamente
 * o certificado cuja assinatura foi validada).
 */
export function extrairDadosDoCertificado(cert: forge.pki.Certificate): {
	nome: string;
	cpf: string;
} {
	// CN (Common Name) - Ex: "JOÃO DA SILVA:12345678901" ou apenas "JOÃO DA SILVA"
	const cnField = cert.subject.getField('CN');
	const commonName = cnField ? String(cnField.value) : '';

	// Tenta extrair o nome (parte antes dos dois pontos)
	const nome = commonName.split(':')[0].trim();

	// Tenta pegar o CPF do atributo serialNumber do subject (OID 2.5.4.5).
	//
	// Bug corrigido: `getField('serialNumber')` em node-forge é traduzido como
	// `{shortName: 'serialNumber'}` — e o atributo serialNumber NÃO tem
	// shortName na tabela OID do forge (só `name`). Antes, o lookup sempre
	// retornava null e o CPF caía no fallback do CN, que falha para certs
	// ICP-Brasil cujo CN não embute o CPF após `:`.
	let cpf = '';
	const snField =
		cert.subject.getField({ type: '2.5.4.5' }) ?? cert.subject.getField({ name: 'serialNumber' });
	if (snField) {
		// No ICP-Brasil, serialNumber pode conter o CPF
		cpf = String(snField.value).replace(/\D/g, '');
	}

	// Fallback: se não achou no serialNumber, tenta no CN (comum em e-CPF)
	if (!cpf && commonName.includes(':')) {
		cpf = commonName.split(':').pop()?.replace(/\D/g, '') || '';
	}

	// Se o CPF extraído for muito longo (ex: contém outros dados), pega os últimos 11
	if (cpf.length > 11) {
		cpf = cpf.slice(-11);
	}

	return { nome, cpf };
}

// ---------------------------------------------------------------------------
// BER → DER recursivo
// ---------------------------------------------------------------------------

/**
 * Converte CMS de BER para DER de forma recursiva, preservando todos os
 * bytes VALUE dos elementos primitivos (OID, OCTET STRING, INTEGER, etc.).
 *
 * Por que é seguro para a assinatura RSA:
 *   - Os signed attributes no SignerInfo já têm comprimentos DER definidos
 *     (o SERPRO os codificou em DER para calcular o hash que assinou).
 *   - Nossa conversão muda APENAS os campos de comprimento de elementos
 *     CONSTRUÍDOS que estejam em BER indefinido (30 80 → 30 82 xx xx).
 *   - Os BYTES VALOR de todos os elementos são copiados sem alteração.
 *   - Portanto: sha256(signedAttrs_DER_original) = sha256(signedAttrs_após_conversão)
 *     e a verificação RSA continua válida.
 *   - Adobe Acrobat exige DER e rejeita CMS com comprimentos indefinidos (BER).
 *
 * Esta conversão recursiva trata o caso em que o próprio SignedData usa
 * comprimento indefinido (caso do SERPRO) — onde converter só os wrappers
 * externos deixaria BER bruto e causaria "Esperado um objeto de número" no Adobe.
 */
function berToDer(ber: Buffer): Buffer {
	let pos = 0;

	function encLen(len: number): Buffer {
		if (len < 0x80) return Buffer.from([len]);
		if (len < 0x100) return Buffer.from([0x81, len]);
		if (len < 0x10000) return Buffer.from([0x82, len >> 8, len & 0xff]);
		return Buffer.from([0x83, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff]);
	}

	function parseElement(): Buffer {
		if (pos + 1 >= ber.length)
			throw new Error(`BER: cabeçalho truncado (pos ${pos}/${ber.length})`);
		const tag = ber[pos++];
		const isConstructed = (tag & 0x20) !== 0;

		// Ler comprimento
		const lb = ber[pos++];
		let len: number;
		let indefinite = false;
		if (lb === 0x80) {
			indefinite = true;
			len = 0;
		} else if ((lb & 0x80) === 0) {
			len = lb;
		} else {
			const n = lb & 0x7f;
			if (pos + n > ber.length)
				throw new Error(
					`BER: bytes de comprimento excedem o buffer (pos ${pos} + ${n} > ${ber.length})`
				);
			len = 0;
			for (let i = 0; i < n; i++) len = (len << 8) | ber[pos++];
		}

		if (!isConstructed) {
			// Primitivo: copiar value bytes sem alteração (preserva hash, assinatura, OID, etc.)
			let value: Buffer;
			if (indefinite) {
				// Primitivo com comprimento indefinido (raro) — ler até 00 00
				const bytes: number[] = [];
				while (!(ber[pos] === 0 && ber[pos + 1] === 0)) {
					if (pos >= ber.length)
						throw new Error(`BER: EOC ausente em primitivo (pos ${pos}/${ber.length})`);
					bytes.push(ber[pos++]);
				}
				pos += 2;
				value = Buffer.from(bytes);
			} else {
				if (pos + len > ber.length)
					throw new Error(
						`BER: valor primitivo excede o buffer (pos ${pos} + len ${len} > ${ber.length})`
					);
				value = Buffer.from(ber.subarray(pos, pos + len));
				pos += len;
			}
			return Buffer.concat([Buffer.from([tag]), encLen(value.length), value]);
		} else {
			// Construído: processar filhos recursivamente
			const children: Buffer[] = [];
			if (indefinite) {
				// Comprimento indefinido: ler filhos até 00 00
				while (!(ber[pos] === 0 && ber[pos + 1] === 0)) {
					if (pos >= ber.length)
						throw new Error(`BER: EOC ausente em construído (pos ${pos}/${ber.length})`);
					children.push(parseElement());
				}
				pos += 2; // consumir 00 00
			} else {
				// Comprimento definido: ler exatamente len bytes de filhos
				const end = pos + len;
				if (end > ber.length)
					throw new Error(`BER: filhos excedem o buffer (end ${end} > ${ber.length})`);
				while (pos < end) children.push(parseElement());
			}
			const content = Buffer.concat(children);
			return Buffer.concat([Buffer.from([tag]), encLen(content.length), content]);
		}
	}

	try {
		const der = parseElement();
		if (import.meta.env.DEV && der.length !== ber.length) {
			logger.debug('[PDF] CMS BER→DER conversão', {
				antes: ber.length,
				depois: der.length
			});
		}
		return der;
	} catch (e) {
		// Fallback ruim: o CMS segue em BER (lengths indefinidos) e o Adobe/strict
		// parser tende a rejeitar ("Estrutura CMS embarcada está malformada"). O log
		// abaixo aponta EXATAMENTE onde a conversão tropeçou — fundamental para
		// estender o conversor a estruturas BER que ainda não cobrimos.
		logger.warn('[PDF] Falha ao converter CMS BER→DER — usando original (Adobe pode rejeitar)', {
			error: e instanceof Error ? e.message : String(e),
			posFalha: pos,
			berLen: ber.length,
			contextoHex: ber.subarray(Math.max(0, pos - 8), Math.min(ber.length, pos + 8)).toString('hex')
		});
		return ber;
	}
}
const OID_RSA_ENCRYPTION = '1.2.840.113549.1.1.1';

/**
 * Formata a data atual no padrão dd/mm/yy HH:MM no fuso de Brasília.
 */
const _fmtDataHora = new Intl.DateTimeFormat('pt-BR', {
	timeZone: 'America/Sao_Paulo',
	day: '2-digit',
	month: '2-digit',
	year: '2-digit',
	hour: '2-digit',
	minute: '2-digit',
	hour12: false
});

export function formatarDataHora(): string {
	const parts = Object.fromEntries(
		_fmtDataHora.formatToParts(new Date()).map((p) => [p.type, p.value])
	);
	return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}`;
}

/**
 * Cria o AlgorithmIdentifier ASN.1 para SHA-256.
 */
function sha256AlgorithmIdentifier(): forge.asn1.Asn1 {
	return forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
		forge.asn1.create(
			forge.asn1.Class.UNIVERSAL,
			forge.asn1.Type.OID,
			false,
			forge.asn1.oidToDer(OID_SHA256).getBytes()
		),
		forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.NULL, false, '')
	]);
}

/**
 * Cria o AlgorithmIdentifier ASN.1 para RSA Encryption.
 */
function rsaAlgorithmIdentifier(): forge.asn1.Asn1 {
	return forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
		forge.asn1.create(
			forge.asn1.Class.UNIVERSAL,
			forge.asn1.Type.OID,
			false,
			forge.asn1.oidToDer(OID_RSA_ENCRYPTION).getBytes()
		),
		forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.NULL, false, '')
	]);
}

/**
 * Constrói o `SignaturePolicyIdentifier` ASN.1 conforme RFC 5126 §5.8.1:
 *
 *   SignaturePolicy ::= CHOICE {
 *       signaturePolicyId          SignaturePolicyId,
 *       signaturePolicyImplied     NULL  -- not used
 *   }
 *
 *   SignaturePolicyId ::= SEQUENCE {
 *       sigPolicyId          OBJECT IDENTIFIER,
 *       sigPolicyHash        AlgorithmIdentifier + OCTET STRING,
 *       sigPolicyQualifiers  ... OPTIONAL
 *   }
 *
 * Resultado: o Validador ITI sai de "Sem política aplicada" para
 * "PA-AD-RB v2.3" — caracteriza a assinatura como conforme PA-AD-RB.
 */
function buildSignaturePolicyId(): forge.asn1.Asn1 {
	const policyHashBytes = forge.util.hexToBytes(resolverHashPolitica());
	return forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
		// sigPolicyId
		forge.asn1.create(
			forge.asn1.Class.UNIVERSAL,
			forge.asn1.Type.OID,
			false,
			forge.asn1.oidToDer(OID_PA_AD_RB_V2_3).getBytes()
		),
		// sigPolicyHash = AlgorithmIdentifier + OCTET STRING (otherHashAlgAndValue alternativo).
		// O Validador ITI aceita o formato simplificado abaixo: SEQUENCE { SHA-256-AlgId, hash }.
		forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
			sha256AlgorithmIdentifier(),
			forge.asn1.create(
				forge.asn1.Class.UNIVERSAL,
				forge.asn1.Type.OCTETSTRING,
				false,
				policyHashBytes
			)
		])
	]);
}

/**
 * Cria os SignedAttributes ASN.1 para a assinatura CMS.
 *
 * Atributos incluídos (ordem alfabética pelo OID — exigência DER):
 *   - 1.2.840.113549.1.9.3   contentType (id-data)
 *   - 1.2.840.113549.1.9.4   messageDigest (SHA-256 do byte-range)
 *   - 1.2.840.113549.1.9.5   signingTime (UTC)
 *   - 1.2.840.113549.1.9.16.2.15  id-aa-ets-sigPolicyId (PA-AD-RB v2.3)
 *
 * @param messageDigest - O hash SHA-256 do conteúdo do PDF (bytes do ByteRange)
 * @param signingTime - A data/hora da assinatura
 */
function buildSignedAttributes(messageDigest: string, signingTime: Date): forge.asn1.Asn1 {
	// SET DER exige ordenação por bytes DER dos elementos. Para os 4 atributos
	// fixos abaixo, a ordem dos OIDs por valor é: contentType (1.9.3),
	// messageDigest (1.9.4), signingTime (1.9.5), sigPolicyId (1.9.16.2.15).
	// node-forge serializa SET na ordem do array; mantemos manualmente.
	return forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SET, true, [
		// contentType (OID 1.2.840.113549.1.9.3)
		forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
			forge.asn1.create(
				forge.asn1.Class.UNIVERSAL,
				forge.asn1.Type.OID,
				false,
				forge.asn1.oidToDer(OID_CONTENT_TYPE).getBytes()
			),
			forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SET, true, [
				forge.asn1.create(
					forge.asn1.Class.UNIVERSAL,
					forge.asn1.Type.OID,
					false,
					forge.asn1.oidToDer(OID_DATA).getBytes()
				)
			])
		]),
		// messageDigest (OID 1.2.840.113549.1.9.4)
		forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
			forge.asn1.create(
				forge.asn1.Class.UNIVERSAL,
				forge.asn1.Type.OID,
				false,
				forge.asn1.oidToDer(OID_MESSAGE_DIGEST).getBytes()
			),
			forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SET, true, [
				forge.asn1.create(
					forge.asn1.Class.UNIVERSAL,
					forge.asn1.Type.OCTETSTRING,
					false,
					messageDigest
				)
			])
		]),
		// signingTime (OID 1.2.840.113549.1.9.5)
		forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
			forge.asn1.create(
				forge.asn1.Class.UNIVERSAL,
				forge.asn1.Type.OID,
				false,
				forge.asn1.oidToDer(OID_SIGNING_TIME).getBytes()
			),
			forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SET, true, [
				forge.asn1.create(
					forge.asn1.Class.UNIVERSAL,
					forge.asn1.Type.UTCTIME,
					false,
					forge.asn1.dateToUtcTime(signingTime)
				)
			])
		]),
		// signaturePolicyId (OID 1.2.840.113549.1.9.16.2.15) — PA-AD-RB v2.3
		forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
			forge.asn1.create(
				forge.asn1.Class.UNIVERSAL,
				forge.asn1.Type.OID,
				false,
				forge.asn1.oidToDer(OID_SIG_POLICY_ID).getBytes()
			),
			forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SET, true, [
				buildSignaturePolicyId()
			])
		])
	]);
}

/**
 * Monta a estrutura CMS SignedData completa em DER.
 *
 * @param certDer - Certificado do signatário em binário (DER)
 * @param signedAttrs - SignedAttributes ASN.1 (com tag SET 0x31)
 * @param signatureBytes - Bytes brutos da assinatura RSA
 */
function buildCmsSignedData(
	certDer: string,
	signedAttrs: forge.asn1.Asn1,
	signatureBytes: string
): string {
	const certAsn1 = forge.asn1.fromDer(certDer);
	const cert = forge.pki.certificateFromAsn1(certAsn1);

	// IssuerAndSerialNumber
	const issuerAsn1 = forge.pki.distinguishedNameToAsn1(cert.issuer);
	const serialHex = cert.serialNumber;
	const serialBytes = forge.util.hexToBytes(serialHex);

	// Converter SignedAttributes de SET (0x31) para IMPLICIT [0] (0xA0)
	const signedAttrsImplicit = forge.asn1.create(
		forge.asn1.Class.CONTEXT_SPECIFIC,
		0,
		true,
		signedAttrs.value as forge.asn1.Asn1[]
	);

	// SignerInfo
	const signerInfo = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
		// version
		forge.asn1.create(
			forge.asn1.Class.UNIVERSAL,
			forge.asn1.Type.INTEGER,
			false,
			forge.asn1.integerToDer(1).getBytes()
		),
		// sid: IssuerAndSerialNumber
		forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
			issuerAsn1,
			forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.INTEGER, false, serialBytes)
		]),
		// digestAlgorithm
		sha256AlgorithmIdentifier(),
		// signedAttrs [0] IMPLICIT
		signedAttrsImplicit,
		// signatureAlgorithm
		rsaAlgorithmIdentifier(),
		// signature
		forge.asn1.create(
			forge.asn1.Class.UNIVERSAL,
			forge.asn1.Type.OCTETSTRING,
			false,
			signatureBytes
		)
	]);

	// SignedData
	const signedData = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
		// version
		forge.asn1.create(
			forge.asn1.Class.UNIVERSAL,
			forge.asn1.Type.INTEGER,
			false,
			forge.asn1.integerToDer(1).getBytes()
		),
		// digestAlgorithms
		forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SET, true, [
			sha256AlgorithmIdentifier()
		]),
		// encapContentInfo (detached = sem conteúdo)
		forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
			forge.asn1.create(
				forge.asn1.Class.UNIVERSAL,
				forge.asn1.Type.OID,
				false,
				forge.asn1.oidToDer(OID_DATA).getBytes()
			)
		]),
		// certificates [0] IMPLICIT
		forge.asn1.create(forge.asn1.Class.CONTEXT_SPECIFIC, 0, true, [certAsn1]),
		// signerInfos
		forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SET, true, [signerInfo])
	]);

	// ContentInfo wrapper
	const contentInfo = forge.asn1.create(
		forge.asn1.Class.UNIVERSAL,
		forge.asn1.Type.SEQUENCE,
		true,
		[
			forge.asn1.create(
				forge.asn1.Class.UNIVERSAL,
				forge.asn1.Type.OID,
				false,
				forge.asn1.oidToDer(OID_SIGNED_DATA).getBytes()
			),
			forge.asn1.create(forge.asn1.Class.CONTEXT_SPECIFIC, 0, true, [signedData])
		]
	);

	return forge.asn1.toDer(contentInfo).getBytes();
}

// ---- Interface para o resultado da preparação ----

interface PrepareResult {
	preparedPdf: Uint8Array;
	signedAttrsHashHex: string;
	messageDigest: string;
	signingTimeISO: string;
	/** Bytes do byte-range do PDF (base64) — usados pelo Assinador SERPRO com type:'file' */
	dataToSignBase64: string;
}

/**
 * Desenha o campo de assinatura no estilo LIMPO (`'rubrica'`): apenas a rubrica
 * do signatário, ajustada para caber na área do campo. Sem moldura, nome, faixa
 * navy, QR ou hash — a identidade ("Assinado digitalmente por…"), o código e o
 * QR vivem no rodapé universal + na página de manifesto. Quando não há rubrica,
 * o campo fica EM BRANCO, espelhando o documento impresso para conferência.
 */
async function desenharCampoRubricaLimpo(
	pdfDoc: PDFDocument,
	page: PDFPage,
	o: {
		boxX: number;
		boxY: number;
		boxW: number;
		boxH: number;
		rubricBase64?: string;
		customRubricX?: number;
		customRubricY?: number;
	}
): Promise<void> {
	if (!o.rubricBase64) return; // sem rubrica → campo em branco (igual ao impresso)
	const { boxX, boxY, boxW, boxH } = o;
	try {
		const rubricImage = o.rubricBase64.includes('image/jpeg')
			? await pdfDoc.embedJpg(o.rubricBase64)
			: await pdfDoc.embedPng(o.rubricBase64);
		const areaW = boxW - 12;
		const areaH = boxH - 12;
		// Ajuste proporcional para caber na área (sem distorcer nem estourar).
		const escala = Math.min(areaW / rubricImage.width, areaH / rubricImage.height, 1);
		const rubW = rubricImage.width * escala;
		const rubH = rubricImage.height * escala;
		const rx = o.customRubricX !== undefined ? o.customRubricX : boxX + (boxW - rubW) / 2;
		// Ancorada junto ao PÉ do campo (logo acima da linha de assinatura), como
		// uma rubrica manuscrita sobre a linha — e não flutuando no meio do campo.
		const ry = o.customRubricY !== undefined ? o.customRubricY : boxY + 5;
		page.drawImage(rubricImage, { x: rx, y: ry, width: rubW, height: rubH, opacity: 0.9 });
	} catch (err) {
		logger.error('Erro ao embutir rubrica no campo limpo', {
			error: err instanceof Error ? err.message : String(err)
		});
	}
}

/**
 * Adiciona carimbo visual + placeholder de assinatura ao PDF,
 * constrói os SignedAttributes do CMS e retorna o hash que o
 * cliente deve assinar via Web PKI.
 */
export async function prepararPdfParaAssinatura(
	pdfBytes: Uint8Array,
	signerName: string,
	alignment: 'center' | 'right' = 'right',
	verificationHash?: string,
	verificationUrl?: string,
	customBoxY?: number,
	rubricBase64?: string,
	customRubricX?: number,
	customRubricY?: number,
	targetPageIndex?: number,
	/**
	 * Estilo do carimbo visual sobre o campo de assinatura:
	 *   - `'selo-icp'` (default): caixa ICP-Brasil completa (faixa navy + QR +
	 *     hash fantasma). Preservado para GISE, relatórios e presença.
	 *   - `'rubrica'`: campo LIMPO — só a rubrica do signatário (ou moldura vazia
	 *     quando não houver), unificando com a cópia de conferência impressa. QR,
	 *     código e base legal migram para o rodapé universal + página de manifesto.
	 */
	estilo: 'selo-icp' | 'rubrica' = 'selo-icp'
): Promise<PrepareResult> {
	const pdfDoc = await PDFDocument.load(pdfBytes);

	const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
	const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
	const fontMono = await pdfDoc.embedFont(StandardFonts.CourierBold);
	const pages = pdfDoc.getPages();
	const pageIdx = targetPageIndex !== undefined ? targetPageIndex : pages.length - 1;
	const lastPage = pages[pageIdx];
	const { width } = lastPage.getSize();
	const dataHora = formatarDataHora();

	// --- Dimensões do carimbo (+5% largura conforme pedido) ---
	const boxW = 158;
	const boxH = 70;

	const marginY = customBoxY !== undefined ? customBoxY : 40;
	const headerH = 9;

	let boxX: number;
	if (alignment === 'center') {
		boxX = (width - boxW) / 2;
	} else {
		boxX = width * 0.75 - boxW / 2;
	}
	const boxY = marginY;

	// --- Paleta ---
	const cNavy = rgb(0.07, 0.14, 0.42);
	const cBlue = rgb(0.18, 0.32, 0.72);
	const cBg = rgb(0.94, 0.96, 0.99);
	const cHatch = rgb(0.82, 0.88, 0.96);
	const cDark = rgb(0.05, 0.08, 0.22);
	const cGray = rgb(0.4, 0.4, 0.45);
	const cWhite = rgb(1, 1, 1);

	// ── Estilo 'rubrica' (campo limpo) ─────────────────────────────────────────
	// Auto-contido: desenha só a rubrica (ou moldura vazia) + legenda enxuta e
	// retorna, deixando TODO o caminho ornamentado abaixo intocado (zero regressão
	// para GISE/relatórios/presença, que seguem em 'selo-icp'). O QR e o código de
	// verificação passam a viver no rodapé universal + na página de manifesto.
	if (estilo === 'rubrica') {
		await desenharCampoRubricaLimpo(pdfDoc, lastPage, {
			boxX,
			boxY,
			boxW,
			boxH,
			rubricBase64,
			customRubricX,
			customRubricY
		});
		return finalizarPreparacao(pdfDoc, {
			reason: 'Assinatura da escala de plantão',
			name: signerName,
			widgetRect: [
				Math.round(boxX),
				Math.round(boxY),
				Math.round(boxX + boxW),
				Math.round(boxY + boxH)
			]
		});
	}

	// 1 — Fundo azul claro (DESENHADO ANTES DA RUBRICA PARA NÃO COBRIR)
	lastPage.drawRectangle({ x: boxX, y: boxY, width: boxW, height: boxH, color: cBg });

	// 2 — Linhas de segurança diagonais
	for (let i = -boxH; i < boxW + 1; i += 8) {
		const tStart = Math.max(0, -i / boxH);
		const tEnd = Math.min(1, (boxW - i) / boxH);
		if (tStart < tEnd) {
			lastPage.drawLine({
				start: { x: boxX + i + tStart * boxH, y: boxY + tStart * boxH },
				end: { x: boxX + i + tEnd * boxH, y: boxY + tEnd * boxH },
				thickness: 0.18,
				color: cHatch
			});
		}
	}

	// 0 — Rubrica (se fornecida)
	if (rubricBase64) {
		try {
			const rubricImage = rubricBase64.includes('image/jpeg')
				? await pdfDoc.embedJpg(rubricBase64)
				: await pdfDoc.embedPng(rubricBase64);
			const rubW = 100; // Reduzido ligeiramente para caber melhor no box
			const rubH = (rubricImage.height / rubricImage.width) * rubW;

			const rx = customRubricX !== undefined ? customRubricX : boxX + (boxW - rubW) / 2;
			const ry = customRubricY !== undefined ? customRubricY : boxY + (boxH - rubH) / 2; // Centralizado no box por padrão

			lastPage.drawImage(rubricImage, {
				x: rx,
				y: ry,
				width: rubW,
				height: rubH,
				opacity: 0.85
			});
		} catch (err) {
			logger.error('Erro ao embutir rubrica no prep', {
				error: err instanceof Error ? err.message : String(err)
			});
		}
	}

	// 3 — Hash fantasma (marca d'água repetida no fundo) preservando limites
	if (verificationHash) {
		const ghostSize = 10; // Reduzido
		const hashWidth = fontMono.widthOfTextAtSize(verificationHash, ghostSize);

		const ghostStep = hashWidth + fontMono.widthOfTextAtSize('  ', ghostSize);
		const ghostY = boxY + (boxH - headerH) / 2 - 5;
		// A condição agora garante que o texto INTEIRO caiba dentro da largura (boxX + boxW)
		for (let gx = boxX + 6; gx + hashWidth < boxX + boxW - 6; gx += ghostStep) {
			lastPage.drawText(verificationHash, {
				x: gx,
				y: ghostY,
				size: ghostSize,
				font: fontMono,
				color: rgb(0.88, 0.91, 0.97)
			});
		}
	}

	// 4 — Faixa de cabeçalho navy
	lastPage.drawRectangle({
		x: boxX,
		y: boxY + boxH - headerH,
		width: boxW,
		height: headerH,
		color: cNavy
	});

	const headerTitle = 'ASSINATURA DIGITAL — ICP-BRASIL — POLÍCIA CIVIL DO CEARÁ';
	const headerFontSize = 4.2;
	const titleWidth = fontBold.widthOfTextAtSize(headerTitle, headerFontSize);
	const titleX = boxX + (boxW - titleWidth) / 2;
	const titleY = boxY + boxH - headerH + (headerH - headerFontSize) / 2 + 0.3; // Centralização vertical refinada

	// Quadrados laterais de acento
	lastPage.drawRectangle({
		x: boxX + 4,
		y: boxY + boxH - headerH + 3,
		width: 3,
		height: 3,
		color: cWhite,
		opacity: 0.5
	});
	lastPage.drawRectangle({
		x: boxX + boxW - 7,
		y: boxY + boxH - headerH + 3,
		width: 3,
		height: 3,
		color: cWhite,
		opacity: 0.5
	});

	lastPage.drawText(headerTitle, {
		x: titleX,
		y: titleY,
		size: headerFontSize,
		font: fontBold,
		color: cWhite
	});

	// 5 — QR Code (com fundo branco, error correction H)
	const qrSize = 42;
	const qrX = boxX + boxW - qrSize - 4;
	const qrYPos = boxY + (boxH - headerH - qrSize) / 2 + 0.5;

	if (verificationUrl) {
		try {
			const qr = QRCode.create(verificationUrl, { errorCorrectionLevel: 'H' });
			const moduleCount = qr.modules.size;
			const dotSize = qrSize / moduleCount;
			lastPage.drawRectangle({
				x: qrX - 2,
				y: qrYPos - 2,
				width: qrSize + 4,
				height: qrSize + 4,
				color: cWhite
			});
			for (let row = 0; row < moduleCount; row++) {
				for (let col = 0; col < moduleCount; col++) {
					if (qr.modules.get(row, col)) {
						lastPage.drawRectangle({
							x: qrX + col * dotSize,
							y: qrYPos + (moduleCount - row - 1) * dotSize,
							width: dotSize + 0.1,
							height: dotSize + 0.1,
							color: cNavy
						});
					}
				}
			}
		} catch (err: unknown) {
			logger.error('Erro ao gerar QR Code para assinatura', {
				error: err instanceof Error ? err.message : String(err)
			});
		}
	}

	// 6 — Linha divisória vertical entre conteúdo e QR
	lastPage.drawLine({
		start: { x: qrX - 5, y: boxY + 5 },
		end: { x: qrX - 5, y: boxY + boxH - headerH - 5 },
		thickness: 0.3,
		color: cBlue
	});

	// 7 — Conteúdo textual
	const txtX = boxX + 6;
	const textMaxW = qrX - boxX - 12;

	lastPage.drawText('Assinado digitalmente por:', {
		x: txtX,
		y: boxY + boxH - headerH - 10,
		size: 5,
		font,
		color: cBlue
	});

	const nomeAssinante = signerName.toUpperCase();
	const nomeFontSize = 6.2; // Reduzido de 7.2

	const words = nomeAssinante.split(' ');
	let line1 = '';
	let line2 = '';
	let useLine2 = false;

	for (const word of words) {
		const testLine = line1 ? line1 + ' ' + word : word;
		if (!useLine2 && fontBold.widthOfTextAtSize(testLine, nomeFontSize) <= textMaxW) {
			line1 = testLine;
		} else {
			useLine2 = true;
			const testLine2 = line2 ? line2 + ' ' + word : word;
			if (fontBold.widthOfTextAtSize(testLine2, nomeFontSize) <= textMaxW) {
				line2 = testLine2;
			} else if (!line2) {
				// Palavra única muito longa
				line2 = word;
				while (
					line2.length > 3 &&
					fontBold.widthOfTextAtSize(line2 + '…', nomeFontSize) > textMaxW
				) {
					line2 = line2.slice(0, -1);
				}
				line2 += '…';
				break;
			} else {
				// Trunca a segunda linha
				while (
					line2.length > 3 &&
					fontBold.widthOfTextAtSize(line2 + '…', nomeFontSize) > textMaxW
				) {
					line2 = line2.slice(0, -1);
				}
				line2 += '…';
				break;
			}
		}
	}

	lastPage.drawText(line1, {
		x: txtX,
		y: boxY + boxH - headerH - 17,
		size: nomeFontSize,
		font: fontBold,
		color: cDark
	});
	if (line2) {
		lastPage.drawText(line2, {
			x: txtX,
			y: boxY + boxH - headerH - 25,
			size: nomeFontSize,
			font: fontBold,
			color: cDark
		});
	}

	const infoLine = dataHora; // Removido CPF repetido conforme pedido
	lastPage.drawText(infoLine, {
		x: txtX,
		y: boxY + boxH - headerH - (line2 ? 33 : 25),
		size: 5.5,
		font,
		color: cGray
	});

	// Caixa de destaque do código de verificação
	if (verificationHash) {
		const hashLabel = `Cód: ${verificationHash}`;
		const hashBgW = fontMono.widthOfTextAtSize(hashLabel, 6) + 10;
		lastPage.drawRectangle({ x: txtX - 2, y: boxY + 12, width: hashBgW, height: 9, color: cNavy });
		lastPage.drawText(hashLabel, {
			x: txtX + 3,
			y: boxY + 15,
			size: 6,
			font: fontMono,
			color: cWhite
		});
	}

	lastPage.drawText('Assinado conforme MP 2.200-2/2001 — ICP-Brasil', {
		x: txtX,
		y: boxY + 4,
		size: 3.8,
		font,
		color: cGray
	});

	// 8 — Borda dupla (desenhada por último para ficar sobre tudo)
	lastPage.drawRectangle({
		x: boxX + 2,
		y: boxY + 2,
		width: boxW - 4,
		height: boxH - 4,
		borderColor: cBlue,
		borderWidth: 0.35
	});
	lastPage.drawRectangle({
		x: boxX,
		y: boxY,
		width: boxW,
		height: boxH,
		borderColor: cNavy,
		borderWidth: 1.1
	});

	// 9 — Texto de verificação vertical na margem esquerda
	if (verificationHash) {
		// Deriva o domínio do próprio verificationUrl (não fixa "escalas.pages.dev",
		// que quebraria num domínio próprio); cai num texto genérico se ausente.
		let baseValidar = 'o portal de validação';
		if (verificationUrl) {
			try {
				baseValidar = new URL(verificationUrl).origin + '/validar';
			} catch {
				baseValidar = verificationUrl.replace(`/${verificationHash}`, '');
			}
		}
		lastPage.drawText(`Para verificar acesse ${baseValidar} · Código: ${verificationHash}`, {
			x: 9,
			y: 32,
			size: 5,
			font,
			color: rgb(0.55, 0.55, 0.55),
			rotate: degrees(90)
		});
	}

	// Widget de assinatura visível — sobreposto à caixa ICP. Ao clicar, o Adobe
	// mostra os detalhes do certificado e o status da assinatura.
	return finalizarPreparacao(pdfDoc, {
		reason: 'Assinatura da escala de plantão',
		name: signerName,
		widgetRect: [
			Math.round(boxX),
			Math.round(boxY),
			Math.round(boxX + boxW),
			Math.round(boxY + boxH)
		]
	});
}

/**
 * Tronco comum da preparação: insere o placeholder de assinatura, recalcula o
 * /ByteRange real e devolve os SignedAttributes a assinar. Compartilhado entre
 * `prepararPdfParaAssinatura` (fluxo qualificado, com caixa visual ICP) e
 * `prepararPdfParaSelo` (selo institucional invisível, fluxo avançado) — fonte
 * única do cálculo de ByteRange/SignedAttributes, evitando drift de segurança.
 */
async function finalizarPreparacao(
	pdfDoc: PDFDocument,
	opts: { reason: string; name: string; widgetRect: [number, number, number, number] }
): Promise<PrepareResult> {
	pdflibAddPlaceholder({
		pdfDoc,
		reason: opts.reason,
		contactInfo: '',
		name: opts.name,
		location: '',
		signatureLength: SIGNATURE_LENGTH,
		byteRangePlaceholder: BYTE_RANGE_PLACEHOLDER,
		subFilter: 'adbe.pkcs7.detached',
		widgetRect: opts.widgetRect
	});

	const savedPdf = await pdfDoc.save();
	const pdfBuffer = removeTrailingNewLine(Buffer.from(savedPdf));

	// Encontrar o ByteRange e calcular os ranges reais
	const pdfString = pdfBuffer.toString('latin1');
	const byteRangePos = pdfString.lastIndexOf(`/ByteRange`);
	if (byteRangePos === -1) {
		throw new Error('Não foi possível encontrar /ByteRange no PDF preparado');
	}

	const bracketStart = pdfString.indexOf('[', byteRangePos);
	const bracketEnd = pdfString.indexOf(']', bracketStart);

	const contentsTagPos = pdfString.lastIndexOf('/Contents <');
	if (contentsTagPos === -1) {
		throw new Error('Não foi possível encontrar /Contents no PDF preparado');
	}

	const sigStart = pdfString.indexOf('<', contentsTagPos + 9);
	const sigEnd = pdfString.indexOf('>', sigStart);

	const br = [0, sigStart, sigEnd + 1, pdfBuffer.length - (sigEnd + 1)];

	// O placeholder original exato, incluindo os colchetes e espaços originais
	const byteRangePlaceholderFull = pdfString.substring(bracketStart, bracketEnd + 1);
	const byteRangeReplacement = `[${br.join(' ')}]`.padEnd(byteRangePlaceholderFull.length, ' ');

	const preparedPdfStr =
		pdfString.substring(0, bracketStart) +
		byteRangeReplacement +
		pdfString.substring(bracketEnd + 1);

	const preparedPdf = Buffer.from(preparedPdfStr, 'latin1');

	// Extrair os bytes que representam o conteúdo assinado
	const dataToSign = Buffer.concat([
		preparedPdf.subarray(br[0], br[1]),
		preparedPdf.subarray(br[2], br[2] + br[3])
	]);

	// Hash SHA-256 do conteúdo do PDF → este é o messageDigest
	const md = forge.md.sha256.create();
	md.update(dataToSign.toString('binary'));
	const messageDigest = md.digest().getBytes(); // binary string

	// Registrar signingTime
	const signingTime = new Date();

	// Construir SignedAttributes e calcular seu hash
	const signedAttrs = buildSignedAttributes(messageDigest, signingTime);
	const signedAttrsDer = forge.asn1.toDer(signedAttrs).getBytes();

	const attrsMd = forge.md.sha256.create();
	attrsMd.update(signedAttrsDer);
	const signedAttrsHashHex = attrsMd.digest().toHex();

	return {
		preparedPdf: new Uint8Array(preparedPdf),
		signedAttrsHashHex,
		messageDigest: forge.util.bytesToHex(messageDigest),
		signingTimeISO: signingTime.toISOString(),
		dataToSignBase64: dataToSign.toString('base64')
	};
}

/**
 * Prepara um PDF para o SELO INSTITUCIONAL (assinatura avançada, Lei 14.063/2020):
 * adiciona um campo de assinatura INVISÍVEL (sem caixa visual e sem branding
 * "ICP-Brasil" — o visual honesto já vem do rodapé/manifesto) e devolve os
 * SignedAttributes a assinar server-side com a chave da instituição.
 */
export async function prepararPdfParaSelo(
	pdfBytes: Uint8Array,
	signerName: string
): Promise<PrepareResult> {
	const pdfDoc = await PDFDocument.load(pdfBytes);
	return finalizarPreparacao(pdfDoc, {
		reason: 'Selo de integridade — Assinatura Eletrônica Avançada (Lei 14.063/2020)',
		name: signerName,
		widgetRect: [0, 0, 0, 0]
	});
}

/**
 * Embute bytes CMS arbitrários no placeholder /Contents do PDF preparado.
 *
 * Reusada por `embedSerproCms` (CMS do cliente) e pelo `cades-finalizer`
 * para re-embed após anexar TST RFC 3161 (CAdES-T).
 *
 * Preserva os bytes do CMS literalmente (sem re-encode ASN.1) — a manipulação
 * de signed attributes invalidaria a assinatura RSA. Quando o caller precisar
 * alterar a estrutura (ex.: adicionar UnsignedAttribute), deve fazê-lo no
 * próprio CMS bytes ANTES de chamar esta função.
 *
 * Aceita bytes maiores que o conteúdo atual do placeholder, desde que caibam
 * no tamanho original reservado (`SIGNATURE_LENGTH`).
 */
export function embedCmsBytesNoPlaceholder(
	preparedPdf: Uint8Array,
	cmsDer: Uint8Array
): Uint8Array {
	const pdfBuffer = Buffer.from(preparedPdf);
	const pdfString = pdfBuffer.toString('latin1');

	const contentsTagPos = pdfString.lastIndexOf('/Contents <');
	if (contentsTagPos === -1) {
		throw new Error('Não foi possível encontrar /Contents no PDF preparado');
	}

	const sigStart = pdfString.indexOf('<', contentsTagPos + 9);
	const sigEnd = pdfString.indexOf('>', sigStart);
	const placeholderLength = sigEnd - sigStart - 1;

	const cmsHex = bytesToHex(cmsDer);

	if (cmsHex.length > placeholderLength) {
		throw new Error(
			`CMS muito grande: ${cmsHex.length / 2} bytes — ` +
				`placeholder suporta ${placeholderLength / 2} bytes. ` +
				`Aumente SIGNATURE_LENGTH em pdf-signing-prepare.ts.`
		);
	}

	const paddedSig = cmsHex.padEnd(placeholderLength, '0');
	const signedPdf = Buffer.from(pdfBuffer);
	signedPdf.write(paddedSig, sigStart + 1, placeholderLength, 'latin1');
	return new Uint8Array(signedPdf);
}

/**
 * Embute o CMS SignedData retornado pelo Assinador SERPRO diretamente no
 * placeholder de assinatura do PDF preparado.
 *
 * ATENÇÃO: o CMS é embutido como-veio do SERPRO (BER), sem re-codificação ASN.1.
 * Re-codificar via forge.asn1.toDer() alteraria os bytes dos signed attributes,
 * que são os exatos bytes sobre os quais o SERPRO calculou a assinatura RSA,
 * invalidando a verificação matemática no Adobe.
 *
 * @param preparedPdf    - PDF com placeholder gerado por prepararPdfParaAssinatura
 * @param serproCmsBase64 - CMS SignedData completo em Base64 (campo 'signature' da resposta SERPRO)
 */
export async function embedSerproCms(
	preparedPdf: Uint8Array,
	serproCmsBase64: string
): Promise<Uint8Array> {
	// Decodifica o CMS retornado pelo SERPRO (BER, com comprimentos indefinidos nos wrappers)
	const cmsBer = Buffer.from(forge.util.decode64(serproCmsBase64), 'binary');
	if (import.meta.env.DEV) {
		logger.debug('[PDF] CMS raw BER prefix', { hex: cmsBer.subarray(0, 20).toString('hex') });
	}

	// Converte APENAS os wrappers externos para DER, preservando o SignedData intacto.
	// Adobe exige DER; re-codificação completa via forge quebraria a assinatura RSA.
	const cmsDer = berToDer(cmsBer);
	if (import.meta.env.DEV) {
		logger.debug('[PDF] CMS DER prefix', { hex: cmsDer.subarray(0, 20).toString('hex') });
	}

	const cmsHex = cmsDer.toString('hex');

	const pdfBuffer = Buffer.from(preparedPdf);
	const pdfString = pdfBuffer.toString('latin1');

	const contentsTagPos = pdfString.lastIndexOf('/Contents <');
	if (contentsTagPos === -1) {
		throw new Error('Não foi possível encontrar /Contents no PDF preparado');
	}

	const sigStart = pdfString.indexOf('<', contentsTagPos + 9);
	const sigEnd = pdfString.indexOf('>', sigStart);
	const placeholderLength = sigEnd - sigStart - 1;

	// Diagnóstico (somente desenvolvimento — evita ruído em produção)
	const byteRangeMatch = pdfString.match(/\/ByteRange\s*\[([^\]]+)\]/);
	if (import.meta.env.DEV) {
		logger.debug('[PDF] embedSerproCms diagnóstico', {
			byteRange: byteRangeMatch?.[1]?.trim() ?? 'NÃO ENCONTRADO',
			sigStart,
			sigEnd,
			placeholderLength,
			placeholderBytes: placeholderLength / 2,
			cmsHexChars: cmsHex.length,
			cmsDerBytes: cmsHex.length / 2
		});
	}

	if (cmsHex.length > placeholderLength) {
		throw new Error(
			`CMS SERPRO muito grande: ${cmsHex.length / 2} bytes — ` +
				`placeholder suporta ${placeholderLength / 2} bytes. ` +
				`Aumente SIGNATURE_LENGTH em pdf-signing-prepare.ts.`
		);
	}

	const paddedSig = cmsHex.padEnd(placeholderLength, '0');
	const signedPdf = Buffer.from(pdfBuffer);
	signedPdf.write(paddedSig, sigStart + 1, placeholderLength, 'latin1');

	return new Uint8Array(signedPdf);
}

/**
 * Monta a estrutura CMS/PKCS#7 SignedData completa e embute no PDF.
 *
 * @param preparedPdf - PDF com placeholder de assinatura
 * @param rawSignatureBase64 - Bytes brutos da assinatura RSA (base64, do Web PKI signHash)
 * @param certificateBase64 - Certificado DER do signatário (base64, do Web PKI readCertificate)
 * @param messageDigestHex - Hash do conteúdo PDF (hex, retornado por prepararPdfParaAssinatura)
 * @param signingTimeISO - Data/hora da assinatura (ISO, retornado por prepararPdfParaAssinatura)
 */
export async function finalizarAssinatura(
	preparedPdf: Uint8Array,
	rawSignatureBase64: string,
	certificateBase64: string,
	messageDigestHex: string,
	signingTimeISO: string
): Promise<Uint8Array> {
	const certDer = forge.util.decode64(certificateBase64);
	const signatureBytes = forge.util.decode64(rawSignatureBase64);
	const messageDigest = forge.util.hexToBytes(messageDigestHex);
	const signingTime = new Date(signingTimeISO);

	// Reconstruir os mesmos SignedAttributes
	const signedAttrs = buildSignedAttributes(messageDigest, signingTime);

	// Montar CMS SignedData completo
	const cmsDer = buildCmsSignedData(certDer, signedAttrs, signatureBytes);
	const cmsHex = forge.util.bytesToHex(cmsDer);

	// Embutir no PDF
	const pdfBuffer = Buffer.from(preparedPdf);
	const pdfString = pdfBuffer.toString('latin1');

	const contentsTagPos = pdfString.lastIndexOf('/Contents <');
	if (contentsTagPos === -1) {
		throw new Error('Não foi possível encontrar /Contents no PDF preparado');
	}

	const sigStart = pdfString.indexOf('<', contentsTagPos + 9);
	const sigEnd = pdfString.indexOf('>', sigStart);
	const placeholderLength = sigEnd - sigStart - 1;

	if (cmsHex.length > placeholderLength) {
		throw new Error(
			`CMS SignedData muito grande: ${cmsHex.length} hex chars, máximo ${placeholderLength}`
		);
	}

	const paddedSig = cmsHex.padEnd(placeholderLength, '0');
	const signedPdf = Buffer.from(pdfBuffer);
	signedPdf.write(paddedSig, sigStart + 1, placeholderLength, 'latin1');

	return new Uint8Array(signedPdf);
}
