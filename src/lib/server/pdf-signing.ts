import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { pdflibAddPlaceholder } from '@signpdf/placeholder-pdf-lib';
import { removeTrailingNewLine } from '@signpdf/utils';
import forge from 'node-forge';

const SIGNATURE_LENGTH = 8192;
const BYTE_RANGE_PLACEHOLDER = '**********';

// OIDs usados na estrutura CMS
const OID_DATA = '1.2.840.113549.1.7.1';
const OID_SIGNED_DATA = '1.2.840.113549.1.7.2';
const OID_CONTENT_TYPE = '1.2.840.113549.1.9.3';
const OID_SIGNING_TIME = '1.2.840.113549.1.9.5';
const OID_MESSAGE_DIGEST = '1.2.840.113549.1.9.4';
const OID_SHA256 = '2.16.840.1.101.3.4.2.1';

// ---------------------------------------------------------------------------
// BER → DER seletivo
// ---------------------------------------------------------------------------

/**
 * Converte **apenas** os wrappers externos do CMS (ContentInfo e [0] EXPLICIT)
 * de comprimentos BER indefinidos para comprimentos DER definidos, mantendo o
 * bloco SignedData **idêntico byte a byte**.
 *
 * Por que isso importa:
 *   - Adobe Acrobat exige DER e rejeita CMS com comprimentos indefinidos.
 *   - O SERPRO assinou sobre os bytes exatos do SignedData (hash dos
 *     signed attributes). Qualquer alteração nesses bytes invalida a RSA.
 *   - Forge.asn1.toDer() faz re-codificação completa e pode mudar bytes
 *     internos (UTCTime, SET ordering etc.), quebrando a verificação.
 *
 * Estrutura esperada do SERPRO type:'hash':
 *   30 80  (ContentInfo, BER indefinido)
 *     06 09 [OID signedData]
 *     a0 80  ([0] EXPLICIT, BER indefinido)
 *       30 82 xx xx [SignedData, DER definido] ← preservado intacto
 *     00 00
 *   00 00
 */
function berWrappersToDer(ber: Buffer): Buffer {
	let pos = 0;

	function readLen(): [len: number, bytes: number] {
		const b = ber[pos];
		if (b === 0x80) return [-1, 1];        // BER indefinido
		if ((b & 0x80) === 0) return [b, 1];   // DER curto (< 128)
		const n = b & 0x7f;
		let len = 0;
		for (let i = 0; i < n; i++) len = (len << 8) | ber[pos + 1 + i];
		return [len, 1 + n];
	}

	function encLen(len: number): Buffer {
		if (len < 0x80) return Buffer.from([len]);
		if (len < 0x100) return Buffer.from([0x81, len]);
		if (len < 0x10000) return Buffer.from([0x82, len >> 8, len & 0xff]);
		return Buffer.from([0x83, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff]);
	}

	// 1. ContentInfo ::= SEQUENCE
	if (ber[pos] !== 0x30) {
		console.warn('[PDF] CMS não inicia com SEQUENCE — usando BER original');
		return ber;
	}
	pos++;
	const [seqLen, seqLenBytes] = readLen();
	pos += seqLenBytes;
	if (seqLen !== -1) {
		console.log('[PDF] CMS já é DER (comprimento definido) — sem conversão');
		return ber;
	}

	// 2. OID (contentType)
	if (ber[pos] !== 0x06) {
		console.warn('[PDF] ContentInfo: OID esperado — usando BER original');
		return ber;
	}
	const oidStart = pos++;
	const [oidLen, oidLenBytes] = readLen();
	pos += oidLenBytes + oidLen;
	const oidBytes = Buffer.from(ber.subarray(oidStart, pos));

	// 3. [0] EXPLICIT
	if (ber[pos] !== 0xa0) {
		console.warn('[PDF] ContentInfo: [0] EXPLICIT esperado — usando BER original');
		return ber;
	}
	pos++;
	const [a0Len, a0LenBytes] = readLen();
	pos += a0LenBytes;

	if (a0Len !== -1) {
		// [0] já é DER — só reencapsular o SEQUENCE externo
		const a0Content = Buffer.from(ber.subarray(pos, pos + a0Len));
		const a0Der = Buffer.concat([Buffer.from([0xa0]), encLen(a0Len), a0Content]);
		const seqContent = Buffer.concat([oidBytes, a0Der]);
		return Buffer.concat([Buffer.from([0x30]), encLen(seqContent.length), seqContent]);
	}

	// 4. SignedData (deve ter comprimento DER definido — é sobre ele que o SERPRO calculou)
	if (ber[pos] !== 0x30) {
		console.warn('[PDF] SignedData: SEQUENCE esperado dentro de [0] — usando BER original');
		return ber;
	}
	const sdStart = pos++;
	const [sdLen, sdLenBytes] = readLen();
	if (sdLen === -1) {
		console.warn('[PDF] SignedData também tem comprimento indefinido — usando BER original');
		return ber;
	}
	pos += sdLenBytes + sdLen;
	// ↑ signedData = ber[sdStart..pos) — bytes PRESERVADOS SEM ALTERAÇÃO
	const signedData = Buffer.from(ber.subarray(sdStart, pos));

	// 5. Reconstruir ContentInfo com comprimentos DER definidos
	const a0Der = Buffer.concat([Buffer.from([0xa0]), encLen(signedData.length), signedData]);
	const seqContent = Buffer.concat([oidBytes, a0Der]);
	const result = Buffer.concat([Buffer.from([0x30]), encLen(seqContent.length), seqContent]);

	console.log(
		`[PDF] CMS BER→DER seletivo: ${ber.length} → ${result.length} bytes ` +
		`(SignedData ${signedData.length} bytes preservados intactos)`
	);
	return result;
}
const OID_RSA_ENCRYPTION = '1.2.840.113549.1.1.1';

/**
 * Formata a data atual no padrão dd/mm/yy HH:MM.
 */
function formatarDataHora(): string {
	const now = new Date();
	const pad = (n: number) => String(n).padStart(2, '0');
	const day = pad(now.getDate());
	const month = pad(now.getMonth() + 1);
	const year = String(now.getFullYear()).slice(-2);
	const hours = pad(now.getHours());
	const minutes = pad(now.getMinutes());
	return `${day}/${month}/${year} ${hours}:${minutes}`;
}

/**
 * Cria o AlgorithmIdentifier ASN.1 para SHA-256.
 */
function sha256AlgorithmIdentifier(): forge.asn1.Asn1 {
	return forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
		forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.OID, false,
			forge.asn1.oidToDer(OID_SHA256).getBytes()),
		forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.NULL, false, '')
	]);
}

/**
 * Cria o AlgorithmIdentifier ASN.1 para RSA Encryption.
 */
function rsaAlgorithmIdentifier(): forge.asn1.Asn1 {
	return forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
		forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.OID, false,
			forge.asn1.oidToDer(OID_RSA_ENCRYPTION).getBytes()),
		forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.NULL, false, '')
	]);
}

/**
 * Cria os SignedAttributes ASN.1 para a assinatura CMS.
 *
 * @param messageDigest - O hash SHA-256 do conteúdo do PDF (bytes do ByteRange)
 * @param signingTime - A data/hora da assinatura
 */
function buildSignedAttributes(messageDigest: string, signingTime: Date): forge.asn1.Asn1 {
	return forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SET, true, [
		// contentType
		forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
			forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.OID, false,
				forge.asn1.oidToDer(OID_CONTENT_TYPE).getBytes()),
			forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SET, true, [
				forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.OID, false,
					forge.asn1.oidToDer(OID_DATA).getBytes())
			])
		]),
		// signingTime
		forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
			forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.OID, false,
				forge.asn1.oidToDer(OID_SIGNING_TIME).getBytes()),
			forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SET, true, [
				forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.UTCTIME, false,
					forge.asn1.dateToUtcTime(signingTime))
			])
		]),
		// messageDigest
		forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
			forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.OID, false,
				forge.asn1.oidToDer(OID_MESSAGE_DIGEST).getBytes()),
			forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SET, true, [
				forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.OCTETSTRING, false,
					messageDigest)
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
		forge.asn1.Class.CONTEXT_SPECIFIC, 0, true,
		signedAttrs.value as forge.asn1.Asn1[]
	);

	// SignerInfo
	const signerInfo = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
		// version
		forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.INTEGER, false,
			forge.asn1.integerToDer(1).getBytes()),
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
		forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.OCTETSTRING, false, signatureBytes)
	]);

	// SignedData
	const signedData = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
		// version
		forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.INTEGER, false,
			forge.asn1.integerToDer(1).getBytes()),
		// digestAlgorithms
		forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SET, true, [
			sha256AlgorithmIdentifier()
		]),
		// encapContentInfo (detached = sem conteúdo)
		forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
			forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.OID, false,
				forge.asn1.oidToDer(OID_DATA).getBytes())
		]),
		// certificates [0] IMPLICIT
		forge.asn1.create(forge.asn1.Class.CONTEXT_SPECIFIC, 0, true, [certAsn1]),
		// signerInfos
		forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SET, true, [signerInfo])
	]);

	// ContentInfo wrapper
	const contentInfo = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
		forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.OID, false,
			forge.asn1.oidToDer(OID_SIGNED_DATA).getBytes()),
		forge.asn1.create(forge.asn1.Class.CONTEXT_SPECIFIC, 0, true, [signedData])
	]);

	return forge.asn1.toDer(contentInfo).getBytes();
}

// ---- Interface para o resultado da preparação ----

export interface PrepareResult {
	preparedPdf: Uint8Array;
	signedAttrsHashHex: string;
	messageDigest: string;
	signingTimeISO: string;
	/** Bytes do byte-range do PDF (base64) — usados pelo Assinador SERPRO com type:'file' */
	dataToSignBase64: string;
}

/**
 * Adiciona carimbo visual + placeholder de assinatura ao PDF,
 * constrói os SignedAttributes do CMS e retorna o hash que o
 * cliente deve assinar via Web PKI.
 */
export async function prepararPdfParaAssinatura(
	pdfBytes: Uint8Array,
	signerName: string,
	signerCpf?: string
): Promise<PrepareResult> {
	const pdfDoc = await PDFDocument.load(pdfBytes);

	// Adicionar carimbo visual + campo de assinatura visível no rodapé da última página
	const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
	const pages = pdfDoc.getPages();
	const lastPage = pages[pages.length - 1];
	const { width } = lastPage.getSize();

	const dataHora = formatarDataHora();

	// Dimensões da caixa de assinatura (canto inferior direito)
	const boxW = 220;
	const boxH = 46;
	const margin = 8;
	const boxX = width - boxW - margin;
	const boxY = margin;

	// Fundo levemente azulado e borda
	lastPage.drawRectangle({
		x: boxX,
		y: boxY,
		width: boxW,
		height: boxH,
		color: rgb(0.95, 0.97, 1.0),
		borderColor: rgb(0.25, 0.35, 0.75),
		borderWidth: 0.6,
		opacity: 1
	});

	// Linha de separação horizontal superior
	lastPage.drawLine({
		start: { x: boxX, y: boxY + boxH - 14 },
		end:   { x: boxX + boxW, y: boxY + boxH - 14 },
		thickness: 0.4,
		color: rgb(0.25, 0.35, 0.75),
		opacity: 0.5
	});

	// Textos dentro da caixa
	const innerX = boxX + 5;
	lastPage.drawText('Assinado digitalmente por:', {
		x: innerX, y: boxY + boxH - 11,
		size: 6, font, color: rgb(0.25, 0.35, 0.75)
	});

	// Nome do assinante (truncado se muito longo)
	const nomeFontSize = 7.5;
	const nomeMaxWidth = boxW - 10;
	let nomeDisplay = signerName;
	while (nomeDisplay.length > 3 && font.widthOfTextAtSize(nomeDisplay, nomeFontSize) > nomeMaxWidth) {
		nomeDisplay = nomeDisplay.slice(0, -1);
	}
	if (nomeDisplay !== signerName) nomeDisplay += '…';
	lastPage.drawText(nomeDisplay, {
		x: innerX, y: boxY + boxH - 23,
		size: nomeFontSize, font, color: rgb(0.05, 0.05, 0.05)
	});

	// Data/hora e info do certificado
	let infoLine = `${dataHora} — ICP-Brasil`;
	if (signerCpf) infoLine += ` — CPF: ${signerCpf}`;
	lastPage.drawText(infoLine, {
		x: innerX, y: boxY + boxH - 35,
		size: 6, font, color: rgb(0.3, 0.3, 0.3)
	});

	// "Verificar no Adobe Acrobat"
	lastPage.drawText('Clique para verificar a validade do certificado', {
		x: innerX, y: boxY + 4,
		size: 5.5, font, color: rgb(0.25, 0.35, 0.75)
	});

	// Widget de assinatura digital visível — sobreposto à caixa visual
	// Ao clicar, o Adobe Acrobat mostra os detalhes do certificado e status
	pdflibAddPlaceholder({
		pdfDoc,
		reason: 'Assinatura da escala de plantão',
		contactInfo: '',
		name: signerName,
		location: '',
		signatureLength: SIGNATURE_LENGTH,
		byteRangePlaceholder: BYTE_RANGE_PLACEHOLDER,
		subFilter: 'adbe.pkcs7.detached',
		widgetRect: [boxX, boxY, boxX + boxW, boxY + boxH]
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
	const byteRangeStr = pdfString.substring(bracketStart + 1, bracketEnd).trim();

	const contentsTagPos = pdfString.lastIndexOf('/Contents <');
	if (contentsTagPos === -1) {
		throw new Error('Não foi possível encontrar /Contents no PDF preparado');
	}

	const sigStart = pdfString.indexOf('<', contentsTagPos + 9);
	const sigEnd = pdfString.indexOf('>', sigStart);

	const br = [0, sigStart, sigEnd + 1, pdfBuffer.length - (sigEnd + 1)];

	// Substituir ByteRange placeholder pelos valores reais
	const byteRangeReplacement = `[${br.join(' ')}]`;
	const byteRangePlaceholderFull = `[${byteRangeStr}]`;
	const preparedPdfStr = pdfString.replace(
		byteRangePlaceholderFull,
		byteRangeReplacement.padEnd(byteRangePlaceholderFull.length, ' ')
	);
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

	// Converte APENAS os wrappers externos para DER, preservando o SignedData intacto.
	// Adobe exige DER; re-codificação completa via forge quebraria a assinatura RSA.
	const cmsDer = berWrappersToDer(cmsBer);

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

	if (cmsHex.length > placeholderLength) {
		throw new Error(
			`CMS SERPRO muito grande: ${cmsHex.length / 2} bytes — ` +
			`placeholder suporta ${placeholderLength / 2} bytes. ` +
			`Aumente SIGNATURE_LENGTH em pdf-signing.ts.`
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
		throw new Error(`CMS SignedData muito grande: ${cmsHex.length} hex chars, máximo ${placeholderLength}`);
	}

	const paddedSig = cmsHex.padEnd(placeholderLength, '0');
	const signedPdf = Buffer.from(pdfBuffer);
	signedPdf.write(paddedSig, sigStart + 1, placeholderLength, 'latin1');

	return new Uint8Array(signedPdf);
}
