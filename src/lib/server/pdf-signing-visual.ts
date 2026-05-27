import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import * as QRCode from 'qrcode';
import { parseUserAgent, descreverTipoCarimbo, type TipoCarimoTempo } from './document-utils';
import { mascararCPF } from '../utils';
import { logger } from './logger';
import { formatarDataHora } from './pdf-signing-prepare';

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
		} catch (err: unknown) {
			logger.error('Erro ao gerar QR Code para rodape simples', {
				error: err instanceof Error ? err.message : String(err)
			});
		}
	}

	const textX = marginX + qrSize + 10;

	// 2 — Informações do assinante (rótulo e nome em linhas separadas; data/URL como antes)
	lastPage.drawText('Confirmado eletronicamente por:', {
		x: textX,
		y: qrY + 32,
		size: 8.5,
		font: fontBold,
		color: cDark
	});
	lastPage.drawText(assinante.toUpperCase(), {
		x: textX,
		y: qrY + 22,
		size: 8.5,
		font: fontBold,
		color: cDark
	});

	// 3 — Data e validadores
	let infoLine = `Data/Hora: ${dataHora}`;
	if (verificationHash) {
		infoLine += `  |  Código: ${verificationHash}`;
	}
	lastPage.drawText(infoLine, {
		x: textX,
		y: qrY + 12,
		size: 7,
		font,
		color: cGray
	});

	if (verificationUrl) {
		const cleanUrl = verificationUrl.replace('https://', '').replace('http://', '');
		lastPage.drawText(`Verificar em: ${cleanUrl}`, {
			x: textX,
			y: qrY + 4,
			size: 7,
			font,
			color: cGray
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
			logger.error('Erro ao embutir rubrica simples', {
				error: err instanceof Error ? err.message : String(err)
			});
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
	/** Resultado do liveness challenge (blink/smile) — registrado para auditoria. */
	livenessChallenge?: {
		tipo: 'blink' | 'smile';
		cumprido: boolean;
		tentativas: number;
		duracaoMs: number;
	} | null;
}

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
			} catch (err) {
				logger.warn('[pdf-signing] QR code de validação', { err: String(err) });
			}
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

			drawP('Identificação', s.signerCpf ? mascararCPF(s.signerCpf) : 'N/A');
			drawP('IP', s.ip || 'Desconhecido');
			// User-Agent legível
			const uaLegivel = parseUserAgent(s.userAgent || '');
			drawP('Dispositivo', uaLegivel);
			// Tipo de carimbo de tempo
			const tipoCarimbo = descreverTipoCarimbo(s.tipoCarimoTempo ?? 'servidor');
			drawP('Carimbo de Tempo', tipoCarimbo);
			drawP('Localização', (s.latitude && s.longitude) ? `${s.latitude}, ${s.longitude}` : 'Não capturado');
			// Liveness challenge (apenas em assinaturas avançadas com selfie).
			if (s.livenessChallenge) {
				const lc = s.livenessChallenge;
				const tipoLabel = lc.tipo === 'blink' ? 'Piscar' : 'Sorrir';
				// Helvetica padrão do pdf-lib usa WinAnsiEncoding e NÃO codifica
				// U+2713/U+2717 (✓/✗) nem o travessão U+2014 (—). Usar esses
				// caracteres faz drawText lançar e o pipeline inteiro retorna 500.
				const status = lc.cumprido ? 'OK' : 'FALHOU';
				const tentLabel = lc.tentativas > 1 ? ` (${lc.tentativas} tentativas)` : '';
				drawP(
					'Prova de Vida',
					`${tipoLabel} ${status}${tentLabel} - ${(lc.duracaoMs / 1000).toFixed(1)}s`
				);
			}

			if (!isQualified) {
				const rubW = 90; const rubX = 340; const fotX = 445; const rowY = boxTop - 25;
				page.drawText('RÚBRICA', { x: rubX, y: rowY, size: 7, font: fontBold, color: cGray });
				page.drawLine({ start: { x: rubX, y: rowY - 5 }, end: { x: rubX + rubW, y: rowY - 5 }, thickness: 0.5, color: cBorder });
				if (s.rubricBase64) {
					try {
						const img = s.rubricBase64.includes('image/jpeg') ? await pdfDoc.embedJpg(s.rubricBase64) : await pdfDoc.embedPng(s.rubricBase64);
						const iw = 80; const ih = (img.height / img.width) * iw;
						page.drawImage(img, { x: rubX + (rubW - iw) / 2, y: rowY - 10 - ih, width: iw, height: ih });
					} catch (err) {
						logger.warn('[pdf-signing] incorporar rúbrica no manifesto', { err: String(err) });
					}
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
					} catch (err) {
						logger.warn('[pdf-signing] incorporar selfie no manifesto', { err: String(err) });
					}
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
		page.drawText(`Manifesto vinculado ao documento de hash ${hashTrunc}`, { x: 40, y: footerY, size: 8, font: fontMono, color: cGray });
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

		// Base legal (direita)
		const legalText = 'Assinatura Eletrônica — Lei 14.063/2020';
		const legalW = font.widthOfTextAtSize(legalText, 5.5);
		page.drawText(legalText, {
			x: width - legalW - 20, y: footerY, size: 5.5, font, color: cGray
		});
	}

	return pdfDoc.save();
}
