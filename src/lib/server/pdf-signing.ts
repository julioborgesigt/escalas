import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib';
import type { PDFPage } from 'pdf-lib';
import { pdflibAddPlaceholder } from '@signpdf/placeholder-pdf-lib';
import { removeTrailingNewLine } from '@signpdf/utils';
import forge from 'node-forge';
import * as QRCode from 'qrcode';
import { parseUserAgent, mascaraCPF, descreverTipoCarimbo, type TipoCarimoTempo } from './document-utils';

const SIGNATURE_LENGTH = 8192;
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
 * Remove acentos e padroniza o texto para comparação.
 */
export function normalizarTexto(text: string): string {
    if (!text) return '';
    return text
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "") // Remove acentos
        .trim()
        .toUpperCase();
}

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

        // CN (Common Name) - Ex: "JOÃO DA SILVA:12345678901" ou apenas "JOÃO DA SILVA"
        const cnField = cert.subject.getField('CN');
        const commonName = cnField ? String(cnField.value) : '';
        
        // Tenta extrair o nome (parte antes dos dois pontos)
        const nome = commonName.split(':')[0].trim();
        
        // Tenta pegar o CPF do serialNumber ou do final do Common Name
        let cpf = '';
        const snField = cert.subject.getField('serialNumber');
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
    } catch (e) {
        console.error('[PDF-SIGN] Erro ao extrair dados do certificado:', e);
        throw new Error('Falha ao processar o certificado digital do Token.');
    }
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
 * O conversor anterior (berWrappersToDer) falhava silenciosamente quando o
 * próprio SignedData usava comprimento indefinido (caso do SERPRO), retornando
 * BER bruto e causando "Esperado um objeto de número" no Adobe.
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
			len = 0;
			for (let i = 0; i < n; i++) len = (len << 8) | ber[pos++];
		}

		if (!isConstructed) {
			// Primitivo: copiar value bytes sem alteração (preserva hash, assinatura, OID, etc.)
			let value: Buffer;
			if (indefinite) {
				// Primitivo com comprimento indefinido (raro) — ler até 00 00
				const bytes: number[] = [];
				while (!(ber[pos] === 0 && ber[pos + 1] === 0)) bytes.push(ber[pos++]);
				pos += 2;
				value = Buffer.from(bytes);
			} else {
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
					children.push(parseElement());
				}
				pos += 2; // consumir 00 00
			} else {
				// Comprimento definido: ler exatamente len bytes de filhos
				const end = pos + len;
				while (pos < end) children.push(parseElement());
			}
			const content = Buffer.concat(children);
			return Buffer.concat([Buffer.from([tag]), encLen(content.length), content]);
		}
	}

	try {
		const der = parseElement();
		if (der.length !== ber.length) {
			console.log(`[PDF] CMS BER→DER: ${ber.length} → ${der.length} bytes (comprimentos indefinidos convertidos)`);
		}
		return der;
	} catch (e) {
		console.warn('[PDF] Falha ao converter CMS BER→DER — usando original:', e);
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

function formatarDataHora(): string {
	const parts = Object.fromEntries(_fmtDataHora.formatToParts(new Date()).map(p => [p.type, p.value]));
	return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}`;
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
	signerCpf?: string,
	alignment: 'center' | 'right' = 'right',
	verificationHash?: string,
	verificationUrl?: string,
	customBoxY?: number,
	rubricBase64?: string,
	customRubricX?: number,
	customRubricY?: number,
	targetPageIndex?: number
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
		boxX = (width * 0.75) - (boxW / 2);
	}
	const boxY = marginY;

	// --- Paleta ---
	const cNavy = rgb(0.07, 0.14, 0.42);
	const cBlue = rgb(0.18, 0.32, 0.72);
	const cBg = rgb(0.94, 0.96, 0.99);
	const cHatch = rgb(0.82, 0.88, 0.96);
	const cDark = rgb(0.05, 0.08, 0.22);
	const cGray = rgb(0.40, 0.40, 0.45);
	const cWhite = rgb(1, 1, 1);

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
				thickness: 0.18, color: cHatch
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
			console.error('Erro ao embutir rubrica no prep:', err);
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
				x: gx, y: ghostY, size: ghostSize, font: fontMono,
				color: rgb(0.88, 0.91, 0.97)
			});
		}
	}

	// 4 — Faixa de cabeçalho navy
	lastPage.drawRectangle({
		x: boxX, y: boxY + boxH - headerH,
		width: boxW, height: headerH, color: cNavy
	});

	const headerTitle = 'ASSINATURA DIGITAL — ICP-BRASIL — POLÍCIA CIVIL DO CEARÁ';
	const headerFontSize = 4.2;
	const titleWidth = fontBold.widthOfTextAtSize(headerTitle, headerFontSize);
	const titleX = boxX + (boxW - titleWidth) / 2;
	const titleY = boxY + boxH - headerH + (headerH - headerFontSize) / 2 + 0.3; // Centralização vertical refinada

	// Quadrados laterais de acento
	lastPage.drawRectangle({ x: boxX + 4, y: boxY + boxH - headerH + 3, width: 3, height: 3, color: cWhite, opacity: 0.5 });
	lastPage.drawRectangle({ x: boxX + boxW - 7, y: boxY + boxH - headerH + 3, width: 3, height: 3, color: cWhite, opacity: 0.5 });

	lastPage.drawText(headerTitle, {
		x: titleX, y: titleY,
		size: headerFontSize, font: fontBold, color: cWhite
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
			lastPage.drawRectangle({ x: qrX - 2, y: qrYPos - 2, width: qrSize + 4, height: qrSize + 4, color: cWhite });
			for (let row = 0; row < moduleCount; row++) {
				for (let col = 0; col < moduleCount; col++) {
					if (qr.modules.get(row, col)) {
						lastPage.drawRectangle({
							x: qrX + col * dotSize,
							y: qrYPos + (moduleCount - row - 1) * dotSize,
							width: dotSize + 0.1, height: dotSize + 0.1, color: cNavy
						});
					}
				}
			}
		} catch (err: any) {
			console.error('Erro ao gerar QR Code para assinatura:', err);
		}
	}

	// 6 — Linha divisória vertical entre conteúdo e QR
	lastPage.drawLine({
		start: { x: qrX - 5, y: boxY + 5 },
		end: { x: qrX - 5, y: boxY + boxH - headerH - 5 },
		thickness: 0.3, color: cBlue
	});


	// 7 — Conteúdo textual
	const txtX = boxX + 6;
	const textMaxW = qrX - boxX - 12;
	const cpfFormatado = signerCpf
		? `CPF: ***.${signerCpf.slice(3, 6)}.${signerCpf.slice(6, 9)}-**`
		: '';

	lastPage.drawText('Assinado digitalmente por:', {
		x: txtX, y: boxY + boxH - headerH - 10,
		size: 5, font, color: cBlue
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
				while (line2.length > 3 && fontBold.widthOfTextAtSize(line2 + '\u2026', nomeFontSize) > textMaxW) {
					line2 = line2.slice(0, -1);
				}
				line2 += '\u2026';
				break;
			} else {
				// Trunca a segunda linha
				while (line2.length > 3 && fontBold.widthOfTextAtSize(line2 + '\u2026', nomeFontSize) > textMaxW) {
					line2 = line2.slice(0, -1);
				}
				line2 += '\u2026';
				break;
			}
		}
	}

	lastPage.drawText(line1, {
		x: txtX, y: boxY + boxH - headerH - 17,
		size: nomeFontSize, font: fontBold, color: cDark
	});
	if (line2) {
		lastPage.drawText(line2, {
			x: txtX, y: boxY + boxH - headerH - 25,
			size: nomeFontSize, font: fontBold, color: cDark
		});
	}

	const infoLine = dataHora; // Removido CPF repetido conforme pedido
	lastPage.drawText(infoLine, {
		x: txtX, y: boxY + boxH - headerH - (line2 ? 33 : 25),
		size: 5.5, font, color: cGray
	});




	// Caixa de destaque do código de verificação
	if (verificationHash) {
		const hashLabel = `Cód: ${verificationHash}`;
		const hashBgW = fontMono.widthOfTextAtSize(hashLabel, 6) + 10;
		lastPage.drawRectangle({ x: txtX - 2, y: boxY + 12, width: hashBgW, height: 9, color: cNavy });
		lastPage.drawText(hashLabel, { x: txtX + 3, y: boxY + 15, size: 6, font: fontMono, color: cWhite });
	}

	lastPage.drawText('Assinado conforme MP 2.200-2/2001 — ICP-Brasil', {
		x: txtX, y: boxY + 4, size: 3.8, font, color: cGray
	});


	// 8 — Borda dupla (desenhada por último para ficar sobre tudo)
	lastPage.drawRectangle({
		x: boxX + 2, y: boxY + 2, width: boxW - 4, height: boxH - 4,
		borderColor: cBlue, borderWidth: 0.35
	});
	lastPage.drawRectangle({
		x: boxX, y: boxY, width: boxW, height: boxH,
		borderColor: cNavy, borderWidth: 1.1
	});

	// 9 — Texto de verificação vertical na margem esquerda
	if (verificationHash) {
		lastPage.drawText(
			`Para verificar acesse https://escalas.pages.dev/validar · Código: ${verificationHash}`,
			{ x: 9, y: 32, size: 5, font, color: rgb(0.55, 0.55, 0.55), rotate: degrees(90) }
		);
	}

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
		widgetRect: [Math.round(boxX), Math.round(boxY), Math.round(boxX + boxW), Math.round(boxY + boxH)]
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

	const preparedPdfStr = pdfString.substring(0, bracketStart) +
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
	console.log(`[PDF] CMS raw BER bytes[0..19]: ${cmsBer.subarray(0, 20).toString('hex')}`);

	// Converte APENAS os wrappers externos para DER, preservando o SignedData intacto.
	// Adobe exige DER; re-codificação completa via forge quebraria a assinatura RSA.
	const cmsDer = berToDer(cmsBer);
	console.log(`[PDF] CMS DER bytes[0..19]:     ${cmsDer.subarray(0, 20).toString('hex')}`);

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

	// Diagnóstico
	const byteRangeMatch = pdfString.match(/\/ByteRange\s*\[([^\]]+)\]/);
	console.log(`[PDF] /ByteRange: ${byteRangeMatch?.[1]?.trim() ?? 'NÃO ENCONTRADO'}`);
	console.log(`[PDF] /Contents: sigStart=${sigStart}, sigEnd=${sigEnd}, placeholderLength=${placeholderLength} (${placeholderLength / 2} bytes)`);
	console.log(`[PDF] cmsHex.length=${cmsHex.length} (${cmsHex.length / 2} bytes)`);

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

// ---------------------------------------------------------------------------
// Assinatura Simples: rodapé textual sem PKI (para escalas de FDS)
// ---------------------------------------------------------------------------

/**
 * Adiciona um rodapé de confirmação administrativa no PDF.
 * Não é uma assinatura PKI — é um carimbo textual com data/hora e nome do responsável.
 */
export interface RodapeSimplesOptions {
	verificationHash?: string;
	verificationUrl?: string;
	rubricBase64?: string;
	customRubricX?: number;
	customRubricY?: number;
	ip?: string;
	latitude?: number | null;
	longitude?: number | null;
	signatureLevel?: 'avancada' | 'qualificada';
}

export async function adicionarRodapeSimples(
	pdfBytes: Uint8Array,
	assinante: string,
	options: RodapeSimplesOptions = {}
): Promise<Uint8Array> {
	const {
		verificationHash,
		verificationUrl,
		rubricBase64,
		customRubricX,
		customRubricY,
		ip,
		latitude,
		longitude
	} = options;
	const pdfDoc = await PDFDocument.load(pdfBytes);
	const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
	const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
	const fontMono = await pdfDoc.embedFont(StandardFonts.CourierBold);

	const pages = pdfDoc.getPages();
	const lastPage = pages[pages.length - 1];
	const { width, height: pageHeight } = lastPage.getSize();

	// --- Posicionamento simplificado (conversão mm para pontos) ---
	const mmToPts = 2.8346;
	const marginX = 20 * mmToPts; // 20mm
	const bottomY = 15 * mmToPts; // 15mm do fundo do PDF

	const dataHora = formatarDataHora();

	const cBlack = rgb(0, 0, 0);
	const cDark = rgb(0.05, 0.08, 0.22);
	const cGray = rgb(0.40, 0.40, 0.45);

	// 1 — QR Code (com fundo branco)
	const qrSize = 35; // Aumentado para melhor visibilidade
	const qrX = marginX;
	const qrY = bottomY - 5; // Centralizado verticalmente com o texto

	if (verificationUrl) {
		try {
			// Usando errorCorrectionLevel H (mais robusto para câmeras)
			const qr = QRCode.create(verificationUrl, { errorCorrectionLevel: 'H' });
			const moduleCount = qr.modules.size;
			const dotSize = qrSize / moduleCount;

			// Fundo branco sutil
			lastPage.drawRectangle({
				x: qrX - 2, y: qrY - 2,
				width: qrSize + 4, height: qrSize + 4,
				color: rgb(1, 1, 1)
			});

			for (let row = 0; row < moduleCount; row++) {
				for (let col = 0; col < moduleCount; col++) {
					if (qr.modules.get(row, col)) {
						lastPage.drawRectangle({
							x: qrX + col * dotSize,
							y: qrY + (moduleCount - row - 1) * dotSize,
							width: dotSize + 0.1, height: dotSize + 0.1,
							color: cBlack // Preto puro para máximo contraste
						});
					}
				}
			}
		} catch (err: any) {
			console.error('Erro ao gerar QR Code para rodape simples:', err);
		}
	}

	const textX = marginX + qrSize + 10;

	// 2 — Informações do assinante - Padrão solicitado pelo usuário
	lastPage.drawText(`Confirmado eletronicamente por: ${assinante.toUpperCase()}`, {
		x: textX, y: qrY + 24, size: 8.5, font: fontBold, color: cDark
	});

	// 3 — Data e validadores
	let infoLine = `Data/Hora: ${dataHora}`;
	if (verificationHash) {
		infoLine += `  |  Código: ${verificationHash}`;
	}
	lastPage.drawText(infoLine, {
		x: textX, y: qrY + 12, size: 7, font, color: cGray
	});

	if (verificationUrl) {
		const cleanUrl = verificationUrl.replace('https://', '').replace('http://', '');
		lastPage.drawText(`Verificar em: ${cleanUrl}`, {
			x: textX, y: qrY + 4, size: 7, font, color: cGray
		});
	}

	// 4 — Rubrica Visual (IP/GPS migrados para o manifesto)

	if (rubricBase64) {
		try {
			const rubricImage = rubricBase64.includes('image/jpeg')
				? await pdfDoc.embedJpg(rubricBase64)
				: await pdfDoc.embedPng(rubricBase64);
			const rubW = 100; // Tamanho menor do que na assinatura com PKI (que é 130)
			const rubH = (rubricImage.height / rubricImage.width) * rubW;

			// Se houver coordenadas personalizadas, usamos. Senão, colocamos no canto direito
			const rx = customRubricX !== undefined ? customRubricX : width - marginX - rubW;
			const ry = customRubricY !== undefined ? customRubricY : qrY - (rubH / 2) + (qrSize / 2);

			lastPage.drawImage(rubricImage, {
				x: rx,
				y: ry,
				width: rubW,
				height: rubH,
				opacity: 0.90
			});
		} catch (err) {
			console.error('Erro ao embutir rubrica simples:', err);
		}
	}

	return pdfDoc.save();
}


// ---------------------------------------------------------------------------
// Página de Auditoria (Audit Trail / Manifesto)
// ---------------------------------------------------------------------------

export interface AuditTrailOptions {
	signerName: string;
	signerCpf?: string;
	signerEmail?: string;
	signingTime: Date;
	verificationHash: string;
	verificationUrl: string;
	ip?: string;
	userAgent?: string;
	latitude?: number | null;
	longitude?: number | null;
	selfieBase64?: string;
	rubricBase64?: string;
	/** Hash SHA-256 do PDF original (antes de carimbo visual e assinatura) */
	documentHash?: string;
	token?: string;
	documentName?: string;
	signatureLevel?: 'avancada' | 'qualificada';
	/** Tipo do carimbo de tempo: 'servidor' (sistema) ou 'act_icp' (TSA ICP-Brasil) */
	tipoCarimoTempo?: TipoCarimoTempo;
}

/**
 * Adiciona uma página de auditoria (Manifesto de Assinatura) ao final do PDF.
 * Inclui foto (selfie), metadados técnicos, localização e QR Code.
 */
/**
 * Adiciona uma página de auditoria (Manifesto de Assinatura) ao final do PDF.
 * Suporta múltiplos assinantes na mesma página (Manifesto Misto).
 * Diferencia assinaturas qualificadas (ICP) de avançadas (tela).
 */
export async function adicionarPaginaAuditoria(
	pdfBytes: Uint8Array,
	options: AuditTrailOptions | AuditTrailOptions[]
): Promise<Uint8Array> {
	const allSigners = Array.isArray(options) ? options : [options];
	const first = allSigners[0];

	const pdfDoc = await PDFDocument.load(pdfBytes);
	const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
	const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
	const fontMono = await pdfDoc.embedFont(StandardFonts.Courier);

	const cNavy = rgb(0.07, 0.14, 0.42);
	const cText = rgb(0.1, 0.1, 0.15);
	const cGray = rgb(0.4, 0.4, 0.45);
	const cLightGray = rgb(0.96, 0.97, 0.98);
	const cBorder = rgb(0.9, 0.92, 0.95);

	// Agrupar assinantes por nível (Qualificada vs Avançada)
	const qualified = allSigners.filter(s => s.signatureLevel === 'qualificada');
	const advanced = allSigners.filter(s => s.signatureLevel === 'avancada');

	const groups = [
		{ title: 'RELATÓRIO DE ASSINATURAS QUALIFICADAS (ICP-BRASIL)', signers: qualified },
		{ title: 'RELATÓRIO DE ASSINATURAS AVANÇADAS (TELA/MOBILE)', signers: advanced }
	].filter(g => g.signers.length > 0);

	for (const group of groups) {
		let page = pdfDoc.addPage();
		const { width, height } = page.getSize();

		// 1 — Topo (Título e Logo tipo ZapSign)
		page.drawText(group.title, { x: 40, y: height - 50, size: 14, font: fontBold, color: cNavy });
		const dataHoraGeral = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long', timeStyle: 'medium' }).format(new Date());
		page.drawText(`Gerado em: ${dataHoraGeral} (Brasília)`, { x: 40, y: height - 65, size: 8, font, color: cGray });
		page.drawLine({ start: { x: 40, y: height - 80 }, end: { x: width - 40, y: height - 80 }, thickness: 0.5, color: cBorder });

		// 2 — Informações do Documento (Apenas na primeira página de cada grupo)
		let currY = height - 105;
		const drawMetaData = (label: string, value: string, y: number, isBold = false) => {
			page.drawText(label + ':', { x: 40, y, size: 8, font: fontBold, color: cText });
			page.drawText(value || 'N/A', { x: 160, y, size: 8.5, font: isBold ? fontBold : font, color: cText });
			return y - 15;
		};

		currY = drawMetaData('Status', 'ASSINADO', currY, true);
		currY = drawMetaData('Documento', first.documentName || 'Extraordinário - GISE', currY);
		currY = drawMetaData('Identificador', first.verificationHash, currY);

		// Hash SHA-256 — exibir completo em duas linhas quando disponível
		const hashReal = first.documentHash && first.documentHash !== 'undefined' && first.documentHash !== 'N/A'
			? first.documentHash
			: null;
		if (hashReal && hashReal.length > 32) {
			// Linha 1: primeiros 32 chars
			page.drawText('Hash do Original:', { x: 40, y: currY, size: 8, font: fontBold, color: cText });
			page.drawText(hashReal.slice(0, 32), { x: 160, y: currY, size: 7.5, font: fontMono, color: cText });
			currY -= 11;
			// Linha 2: restante
			page.drawText(hashReal.slice(32), { x: 160, y: currY, size: 7.5, font: fontMono, color: cText });
			currY -= 15;
		} else {
			currY = drawMetaData('Hash do Original', hashReal ?? '(calculado no momento da assinatura)', currY);
		}

		// QR Code de Validação no canto superior direito
		if (first.verificationUrl) {
			try {
				const qrSize = 65;
				const qr = QRCode.create(first.verificationUrl, { errorCorrectionLevel: 'H' });
				const moduleCount = qr.modules.size;
				const dotSize = qrSize / moduleCount;
				for (let r = 0; r < moduleCount; r++) {
					for (let c = 0; c < moduleCount; c++) {
						if (qr.modules.get(r, c)) {
							page.drawRectangle({
								x: (width - 105) + c * dotSize, y: (height - 155) + (moduleCount - r - 1) * dotSize,
								width: dotSize + 0.1, height: dotSize + 0.1, color: cNavy
							});
						}
					}
				}
				// Instrução de validação abaixo do QR
				page.drawText('Para verificar a autenticidade e integridade', {
					x: width - 200, y: height - 168, size: 6, font, color: cGray
				});
				page.drawText('deste documento, acesse a URL de validação', {
					x: width - 200, y: height - 177, size: 6, font, color: cGray
				});
				page.drawText('ou aponte a câmera para o QR Code.', {
					x: width - 200, y: height - 186, size: 6, font, color: cGray
				});
			} catch (e) { }
		}

		page.drawLine({ start: { x: 40, y: currY - 10 }, end: { x: width - 40, y: currY - 10 }, thickness: 0.5, color: cBorder });
		currY -= 40;

		// 3 — Seção de Assinaturas do Grupo
		for (let i = 0; i < group.signers.length; i++) {
			const s = group.signers[i];
			const boxH = 145;

			if (currY - boxH < 60) {
				page = pdfDoc.addPage();
				const { height: nh } = page.getSize();
				page.drawText(`${group.title} (Continuação)`, { x: 40, y: nh - 50, size: 12, font: fontBold, color: cNavy });
				page.drawLine({ start: { x: 40, y: nh - 80 }, end: { x: width - 40, y: nh - 80 }, thickness: 0.5, color: cBorder });
				currY = nh - 110;
			}

			page.drawRectangle({ x: 40, y: currY - boxH, width: width - 80, height: boxH, color: cLightGray, borderColor: cBorder, borderWidth: 1 });
			const boxTop = currY;

			const isQualified = s.signatureLevel === 'qualificada';
			const badgeColor = isQualified ? rgb(0.1, 0.3, 0.7) : rgb(0.1, 0.5, 0.2);
			const badgeBg = isQualified ? rgb(0.9, 0.94, 1.0) : rgb(0.9, 0.98, 0.92);
			const badgeLabel = isQualified ? 'QUALIFICADA (ICP-BRASIL)' : 'AVANÇADA (TELA/MOBILE)';

			page.drawRectangle({ x: 55, y: boxTop - 25, width: 105, height: 16, color: badgeBg });
			page.drawText(badgeLabel, { x: 58, y: boxTop - 20, size: 6.5, font: fontBold, color: badgeColor });

			page.drawText(s.signerName.toUpperCase(), { x: 55, y: boxTop - 45, size: 11, font: fontBold, color: cText });
			const dataAssinatura = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'medium' }).format(s.signingTime);
			page.drawText(`Data e hora da assinatura: ${dataAssinatura}`, { x: 55, y: boxTop - 58, size: 8, font, color: cGray });
			page.drawText(`Token: ${s.token || s.verificationHash}`, { x: 55, y: boxTop - 70, size: 8, font, color: cGray });

			// E-mail institucional (se disponível)
			if (s.signerEmail) {
				page.drawText(`E-mail: ${s.signerEmail}`, { x: 55, y: boxTop - 82, size: 7.5, font, color: cGray });
			}

			let authY = s.signerEmail ? boxTop - 100 : boxTop - 95;
			const drawP = (label: string, val: string) => {
				page.drawText(label + ':', { x: 55, y: authY, size: 7, font: fontBold, color: cGray });
				page.drawText(val || 'N/A', { x: 130, y: authY, size: 7, font, color: cText });
				authY -= 12;
			};

			drawP('Identificação', s.signerCpf ? mascaraCPF(s.signerCpf) : 'N/A');
			drawP('IP', s.ip || 'Desconhecido');
			// User-Agent legível
			const uaLegivel = parseUserAgent(s.userAgent || '');
			drawP('Dispositivo', uaLegivel);
			// Tipo de carimbo de tempo
			const tipoCarimbo = descreverTipoCarimbo(s.tipoCarimoTempo ?? 'servidor');
			drawP('Carimbo de Tempo', tipoCarimbo);
			drawP('Localização', (s.latitude && s.longitude) ? `${s.latitude}, ${s.longitude}` : 'Não capturado');

			if (!isQualified) {
				const rubW = 90; const rubX = 340; const fotX = 445; const rowY = boxTop - 25;
				page.drawText('RÚBRICA', { x: rubX, y: rowY, size: 7, font: fontBold, color: cGray });
				page.drawLine({ start: { x: rubX, y: rowY - 5 }, end: { x: rubX + rubW, y: rowY - 5 }, thickness: 0.5, color: cBorder });
				if (s.rubricBase64) {
					try {
						const img = s.rubricBase64.includes('image/jpeg') ? await pdfDoc.embedJpg(s.rubricBase64) : await pdfDoc.embedPng(s.rubricBase64);
						const iw = 80; const ih = (img.height / img.width) * iw;
						page.drawImage(img, { x: rubX + (rubW - iw) / 2, y: rowY - 10 - ih, width: iw, height: ih });
					} catch (e) { }
				}
				page.drawText('FOTO', { x: fotX, y: rowY, size: 7, font: fontBold, color: cGray });
				page.drawLine({ start: { x: fotX, y: rowY - 5 }, end: { x: fotX + rubW, y: rowY - 5 }, thickness: 0.5, color: cBorder });
				if (s.selfieBase64) {
					try {
						const data = s.selfieBase64.includes(',') ? s.selfieBase64.split(',')[1] : s.selfieBase64;
						const bytes = Buffer.from(data, 'base64');
						const img = await pdfDoc.embedJpg(bytes);
						const iw = 80; const ih = (img.height / img.width) * iw;
						page.drawImage(img, { x: fotX + (rubW - iw) / 2, y: rowY - 10 - ih, width: iw, height: ih });
					} catch (e) { }
				}
			}
			currY -= boxH + 15;
		}

		// Rodapé de Compliance
		const hasQualified = group.signers.some(s => s.signatureLevel === 'qualificada');
		const footerY = 60;
		if (hasQualified) {
			page.drawText('INTEGRIDADE CERTIFICADA - ICP-BRASIL', { x: 40, y: footerY + 25, size: 10, font: fontBold, color: cText });
			page.drawText('Assinaturas eletrônicas têm igual validade legal conforme MP 2.200-2/2001 e Lei 14.063/2020.', { x: 40, y: footerY + 12, size: 7, font, color: cGray });
		} else {
			page.drawText('VALIDADE JURÍDICA ASSEGURADA - LEI 14.063/20', { x: 40, y: footerY + 25, size: 10, font: fontBold, color: cText });
			page.drawText('Este documento utiliza assinaturas eletrônicas avançadas com plena eficácia probatória.', { x: 40, y: footerY + 12, size: 7, font, color: cGray });
		}
		const hashTrunc = first.documentHash ? first.documentHash.slice(0, 16) + '...' : '';
		page.drawText(`Manifesto vinculado ao documento de hash ${hashTrunc}`, { x: 40, y: footerY, size: 6, font: fontMono, color: cGray });
	}

	return pdfDoc.save();
}

// ---------------------------------------------------------------------------
// Rodapé Universal em Todas as Páginas de Conteúdo
// ---------------------------------------------------------------------------

export interface RodapeUniversalOptions {
	/** Hash SHA-256 do PDF original */
	documentHash: string;
	/** URL completa de validação (ex: https://escalas.pages.dev/validar/XXXX) */
	verificationUrl: string;
	/** Código de verificação curto (ex: B48T-4N22) */
	verificationHash: string;
	/** Índice da última página de conteúdo (0-based). A página seguinte é a de auditoria. */
	contentPageCount?: number;
}

/**
 * Injeta um rodapé padronizado em todas as páginas de conteúdo do PDF.
 *
 * Deve ser chamado ANTES de prepararPdfParaAssinatura para que o rodapé
 * esteja coberto pelo hash criptográfico da assinatura.
 *
 * O rodapé contém:
 * - Hash SHA-256 abreviado do arquivo original
 * - URL de validação
 * - Base legal: "Assinatura Eletrônica — Lei 14.063/2020"
 */
export async function adicionarRodapeUniversal(
	pdfBytes: Uint8Array,
	options: RodapeUniversalOptions
): Promise<Uint8Array> {
	const { documentHash, verificationUrl, verificationHash, contentPageCount } = options;

	const pdfDoc = await PDFDocument.load(pdfBytes);
	const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
	const fontMono = await pdfDoc.embedFont(StandardFonts.Courier);

	const cNavy = rgb(0.07, 0.14, 0.42);
	const cGray = rgb(0.55, 0.55, 0.60);
	const cLightLine = rgb(0.80, 0.85, 0.92);

	const pages = pdfDoc.getPages();
	// Aplica em todas as páginas, ou apenas nas de conteúdo (exclui folha de auditoria)
	const lastContentIdx = contentPageCount !== undefined ? contentPageCount - 1 : pages.length - 1;

	const hashAbrev = documentHash ? documentHash.slice(0, 16) + '...' + documentHash.slice(-8) : '';
	const urlLimpa = verificationUrl.replace('https://', '');

	for (let i = 0; i <= lastContentIdx; i++) {
		const page = pages[i];
		const { width } = page.getSize();
		const footerY = 18;

		// Linha separadora
		page.drawLine({
			start: { x: 20, y: footerY + 10 },
			end: { x: width - 20, y: footerY + 10 },
			thickness: 0.3,
			color: cLightLine
		});

		// Hash abreviado (esquerda)
		page.drawText(`SHA-256: ${hashAbrev}`, {
			x: 20, y: footerY, size: 5.5, font: fontMono, color: cGray
		});

		// URL de validação (centro)
		const urlText = `Validar: ${urlLimpa}`;
		const urlW = font.widthOfTextAtSize(urlText, 5.5);
		page.drawText(urlText, {
			x: (width - urlW) / 2, y: footerY, size: 5.5, font, color: cNavy
		});

		// Base legal (direita)
		const legalText = 'Assinatura Eletrônica — Lei 14.063/2020';
		const legalW = font.widthOfTextAtSize(legalText, 5.5);
		page.drawText(legalText, {
			x: width - legalW - 20, y: footerY, size: 5.5, font, color: cGray
		});
	}

	return pdfDoc.save();
}
