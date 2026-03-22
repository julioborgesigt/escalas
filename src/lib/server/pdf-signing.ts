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

	// Adicionar carimbo de assinatura no rodapé (canto inferior direito) da última página
	const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
	const fontSize = 8;
	const pages = pdfDoc.getPages();
	const lastPage = pages[pages.length - 1];
	const { width } = lastPage.getSize();

	const dataHora = formatarDataHora();
	let stampText = `Assinado digitalmente em ${dataHora} por: ${signerName}`;
	if (signerCpf) {
		stampText += ` - CPF: ${signerCpf}`;
	}

	const textWidth = font.widthOfTextAtSize(stampText, fontSize);
	const rightMargin = 10;
	const bottomMargin = 10;

	lastPage.drawText(stampText, {
		x: width - textWidth - rightMargin,
		y: bottomMargin,
		size: fontSize,
		font,
		color: rgb(0.2, 0.2, 0.2)
	});

	pdflibAddPlaceholder({
		pdfDoc,
		reason: 'Assinatura da escala de plantão',
		contactInfo: '',
		name: signerName,
		location: '',
		signatureLength: SIGNATURE_LENGTH,
		byteRangePlaceholder: BYTE_RANGE_PLACEHOLDER,
		subFilter: 'adbe.pkcs7.detached',
		widgetRect: [0, 0, 0, 0]
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
 * O SERPRO retorna um CMS em BER (codificação de comprimento indefinido).
 * Este método converte para DER de comprimento definido antes de embutir.
 *
 * @param preparedPdf    - PDF com placeholder gerado por prepararPdfParaAssinatura
 * @param serproCmsBase64 - CMS SignedData completo em Base64 (campo 'signature' da resposta SERPRO)
 */
export async function embedSerproCms(
	preparedPdf: Uint8Array,
	serproCmsBase64: string
): Promise<Uint8Array> {
	// Decodifica o CMS BER retornado pelo SERPRO
	const cmsBer = forge.util.decode64(serproCmsBase64);

	// Converte BER → DER e converte para detached (remove eContent se presente).
	// Para PDF, o CMS deve ser detached: encapContentInfo só tem eContentType, sem eContent.
	let cmsDer: string;
	try {
		const asn1 = forge.asn1.fromDer(cmsBer, { strict: false } as forge.asn1.Asn1Options);

		// Navega: ContentInfo[1]=[0]EXPLICIT → SignedData → encapContentInfo
		// ContentInfo.value = [OID, [0]EXPLICIT]
		// [0]EXPLICIT.value = [SignedData]
		// SignedData.value = [version, digestAlgorithms, encapContentInfo, ...]
		const contentInfoChildren = asn1.value as forge.asn1.Asn1[];
		const signedDataWrapper = contentInfoChildren[1]; // [0] EXPLICIT
		const signedDataChildren = (signedDataWrapper.value as forge.asn1.Asn1[])[0].value as forge.asn1.Asn1[];
		const encapCI = signedDataChildren[2]; // EncapsulatedContentInfo SEQUENCE
		const encapChildren = encapCI.value as forge.asn1.Asn1[];

		// Remove eContent (índice 1) se presente, tornando o CMS detached
		if (encapChildren.length > 1) {
			console.log(`[PDF] CMS SERPRO attached (eContent presente, ${encapChildren.length - 1} campo extra). Convertendo para detached.`);
			encapChildren.splice(1); // mantém só o eContentType OID
		}

		cmsDer = forge.asn1.toDer(asn1).getBytes();
		console.log(`[PDF] CMS convertido BER→DER: ${cmsDer.length} bytes`);
	} catch (e) {
		console.warn('[PDF] Não foi possível converter BER→DER; usando CMS original do SERPRO.', e);
		cmsDer = cmsBer;
	}

	const cmsHex = forge.util.bytesToHex(cmsDer);

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
