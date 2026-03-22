import { PDFDocument } from 'pdf-lib';
import { pdflibAddPlaceholder } from '@signpdf/placeholder-pdf-lib';
import { removeTrailingNewLine } from '@signpdf/utils';

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
	const pdfBuffer = removeTrailingNewLine(Buffer.from(savedPdf));

	// Encontrar o ByteRange placeholder manualmente no PDF
	const pdfString = pdfBuffer.toString('latin1');
	const byteRangePos = pdfString.lastIndexOf(`/ByteRange`);
	if (byteRangePos === -1) {
		throw new Error('Não foi possível encontrar /ByteRange no PDF preparado');
	}

	const bracketStart = pdfString.indexOf('[', byteRangePos);
	const bracketEnd = pdfString.indexOf(']', bracketStart);
	const byteRangeStr = pdfString.substring(bracketStart + 1, bracketEnd).trim();

	// Encontrar a posição do conteúdo da assinatura (<0000...>)
	const contentsTagPos = pdfString.lastIndexOf('/Contents <');
	if (contentsTagPos === -1) {
		throw new Error('Não foi possível encontrar /Contents no PDF preparado');
	}

	const sigStart = pdfString.indexOf('<', contentsTagPos + 9);
	const sigEnd = pdfString.indexOf('>', sigStart);

	// Calcular ByteRange real
	const br = [
		0,
		sigStart,
		sigEnd + 1,
		pdfBuffer.length - (sigEnd + 1)
	];

	// Substituir o ByteRange placeholder pelos valores reais
	const byteRangeReplacement = `[${br.join(' ')}]`;
	const byteRangePlaceholderFull = `[${byteRangeStr}]`;

	// Criar o PDF com ByteRange preenchido
	const preparedPdfStr = pdfString.replace(byteRangePlaceholderFull, byteRangeReplacement.padEnd(byteRangePlaceholderFull.length, ' '));
	const preparedPdf = Buffer.from(preparedPdfStr, 'latin1');

	// Extrair os bytes que precisam ser assinados (antes + depois do placeholder de assinatura)
	const dataToSign = Buffer.concat([
		preparedPdf.subarray(br[0], br[1]),
		preparedPdf.subarray(br[2], br[2] + br[3])
	]);

	// Calcular hash SHA-256
	const hashBuffer = await crypto.subtle.digest('SHA-256', dataToSign);
	const hashArray = new Uint8Array(hashBuffer);
	const hashHex = Array.from(hashArray)
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');

	return {
		preparedPdf: new Uint8Array(preparedPdf),
		hashHex
	};
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
	const pkcs7Hex = pkcs7Bytes.toString('hex');

	const pdfBuffer = Buffer.from(preparedPdf);
	const pdfString = pdfBuffer.toString('latin1');

	// Encontrar o placeholder de assinatura (sequência de zeros entre < >)
	const contentsTagPos = pdfString.lastIndexOf('/Contents <');
	if (contentsTagPos === -1) {
		throw new Error('Não foi possível encontrar /Contents no PDF preparado');
	}

	const sigStart = pdfString.indexOf('<', contentsTagPos + 9);
	const sigEnd = pdfString.indexOf('>', sigStart);
	const placeholderLength = sigEnd - sigStart - 1; // tamanho em hex chars

	if (pkcs7Hex.length > placeholderLength) {
		throw new Error(`Assinatura muito grande: ${pkcs7Hex.length} hex chars, máximo ${placeholderLength}`);
	}

	// Preencher com a assinatura hex, padded com zeros
	const paddedSig = pkcs7Hex.padEnd(placeholderLength, '0');

	// Substituir no buffer
	const signedPdf = Buffer.from(pdfBuffer);
	signedPdf.write(paddedSig, sigStart + 1, placeholderLength, 'latin1');

	return new Uint8Array(signedPdf);
}
