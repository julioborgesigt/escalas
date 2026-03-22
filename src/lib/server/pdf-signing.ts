import { PDFDocument } from 'pdf-lib';
import { pdflibAddPlaceholder } from '@signpdf/placeholder-pdf-lib';
import signpdfModule from '@signpdf/signpdf';
import { removeTrailingNewLine, findByteRange, Signer } from '@signpdf/utils';

const SIGNATURE_LENGTH = 8192;
const BYTE_RANGE_PLACEHOLDER = '**********';

/**
 * Adiciona um placeholder de assinatura digital ao PDF e calcula o hash
 * dos bytes que precisam ser assinados.
 *
 * Retorna o PDF preparado (com placeholder) e o hash SHA-256 em hex
 * que deve ser assinado pelo cliente via Lacuna Web PKI.
 */
export async function prepararPdfParaAssinatura(
	pdfBytes: Uint8Array,
	signerName: string
): Promise<{ preparedPdf: Uint8Array; hashHex: string }> {
	const pdfDoc = await PDFDocument.load(pdfBytes);

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
	const pdfBuffer = Buffer.from(savedPdf);
	const normalizedPdf = removeTrailingNewLine(pdfBuffer);

	// Encontrar o ByteRange no PDF
	const byteRangeInfo = findByteRange(normalizedPdf, BYTE_RANGE_PLACEHOLDER);

	if (
		!byteRangeInfo.byteRange ||
		byteRangeInfo.byteRange.length < 4
	) {
		throw new Error('Não foi possível encontrar o ByteRange no PDF preparado');
	}

	const br = byteRangeInfo.byteRange.map(Number);

	// Extrair os bytes que precisam ser assinados (antes + depois do placeholder)
	const dataToSign = Buffer.concat([
		normalizedPdf.subarray(br[0], br[0] + br[1]),
		normalizedPdf.subarray(br[2], br[2] + br[3])
	]);

	// Calcular hash SHA-256
	const hashBuffer = await crypto.subtle.digest('SHA-256', dataToSign);
	const hashHex = Array.from(new Uint8Array(hashBuffer))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');

	return {
		preparedPdf: new Uint8Array(normalizedPdf),
		hashHex
	};
}

/**
 * Signer customizado que retorna uma assinatura PKCS#7 produzida externamente.
 */
class ExternalPkcs7Signer extends Signer {
	private externalSignature: Buffer;

	constructor(pkcs7Bytes: Buffer) {
		super();
		this.externalSignature = pkcs7Bytes;
	}

	async sign(): Promise<Buffer> {
		return this.externalSignature;
	}
}

/**
 * Embute uma assinatura PKCS#7 (produzida externamente, ex: Lacuna Web PKI)
 * no PDF preparado com placeholder.
 *
 * Retorna o PDF assinado final.
 */
export async function finalizarAssinatura(
	preparedPdf: Uint8Array,
	pkcs7Base64: string
): Promise<Uint8Array> {
	const pkcs7Bytes = Buffer.from(pkcs7Base64, 'base64');
	const signer = new ExternalPkcs7Signer(pkcs7Bytes);
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const SignPdf = (signpdfModule as any).default || signpdfModule;
	const signpdf = new SignPdf() as { sign(pdf: Buffer, signer: ExternalPkcs7Signer): Promise<Buffer> };

	const signedPdf = await signpdf.sign(Buffer.from(preparedPdf), signer);
	return new Uint8Array(signedPdf);
}
