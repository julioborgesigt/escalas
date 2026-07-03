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
interface RodapeSimplesOptions {
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
	const { verificationHash, verificationUrl, rubricBase64, customRubricX, customRubricY } = options;
	const pdfDoc = await PDFDocument.load(pdfBytes);
	const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
	const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

	const pages = pdfDoc.getPages();
	const lastPage = pages[pages.length - 1];
	const { width } = lastPage.getSize();

	// --- Posicionamento simplificado (conversão mm para pontos) ---
	const mmToPts = 2.8346;
	const marginX = 20 * mmToPts; // 20mm
	const bottomY = 15 * mmToPts; // 15mm do fundo do PDF

	const dataHora = formatarDataHora();

	const cBlack = rgb(0, 0, 0);
	const cDark = rgb(0.05, 0.08, 0.22);
	const cGray = rgb(0.4, 0.4, 0.45);

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
				x: qrX - 2,
				y: qrY - 2,
				width: qrSize + 4,
				height: qrSize + 4,
				color: rgb(1, 1, 1)
			});

			for (let row = 0; row < moduleCount; row++) {
				for (let col = 0; col < moduleCount; col++) {
					if (qr.modules.get(row, col)) {
						lastPage.drawRectangle({
							x: qrX + col * dotSize,
							y: qrY + (moduleCount - row - 1) * dotSize,
							width: dotSize + 0.1,
							height: dotSize + 0.1,
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
			const ry = customRubricY !== undefined ? customRubricY : qrY - rubH / 2 + qrSize / 2;

			lastPage.drawImage(rubricImage, {
				x: rx,
				y: ry,
				width: rubW,
				height: rubH,
				opacity: 0.9
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
	/** Tipo do carimbo de tempo: 'servidor' (sistema), 'act_icp' (ACT ICP-Brasil)
	 *  ou 'tsa_externa' (TSA RFC 3161 não-ICP, ex.: DigiCert). */
	tipoCarimoTempo?: TipoCarimoTempo;
	/** Resultado do liveness challenge (head_turn/smile) — registrado para auditoria. */
	livenessChallenge?: {
		tipo: 'blink' | 'smile' | 'head_turn';
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
	// O cabeçalho do manifesto (Identificador + QR) deve referenciar a assinatura
	// PRIMÁRIA do documento — a que assina o PDF criptograficamente e é registrada
	// em /validar. Em manifestos multi-assinante (relatório extra = presenças +
	// supervisor) essa é a ÚLTIMA adicionada; em single-signer, é a única. Usar
	// allSigners[0] apontava o QR para a 1ª presença (hash que não resolve no doc).
	const principal = allSigners[allSigners.length - 1];

	const pdfDoc = await PDFDocument.load(pdfBytes);
	const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
	const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
	const fontMono = await pdfDoc.embedFont(StandardFonts.Courier);

	const cNavy = rgb(0.07, 0.14, 0.42);
	const cText = rgb(0.1, 0.1, 0.15);
	const cGray = rgb(0.4, 0.4, 0.45);
	const cBorder = rgb(0.9, 0.92, 0.95);

	// Agrupar assinantes por nível (Qualificada vs Avançada)
	const qualified = allSigners.filter((s) => s.signatureLevel === 'qualificada');
	const advanced = allSigners.filter((s) => s.signatureLevel === 'avancada');

	const groups = [
		{ title: 'RELATÓRIO DE ASSINATURAS QUALIFICADAS (ICP-BRASIL)', signers: qualified },
		{ title: 'RELATÓRIO DE ASSINATURAS AVANÇADAS (TELA/MOBILE)', signers: advanced }
	].filter((g) => g.signers.length > 0);

	for (const group of groups) {
		let page = pdfDoc.addPage();
		const { width, height } = page.getSize();

		// 1 — Topo (Título e Logo tipo ZapSign)
		page.drawText(group.title, { x: 40, y: height - 50, size: 14, font: fontBold, color: cNavy });
		const dataHoraGeral = new Intl.DateTimeFormat('pt-BR', {
			dateStyle: 'long',
			timeStyle: 'medium',
			timeZone: 'America/Sao_Paulo'
		}).format(new Date());
		page.drawText(`Gerado em: ${dataHoraGeral} (Brasília)`, {
			x: 40,
			y: height - 65,
			size: 8,
			font,
			color: cGray
		});
		page.drawLine({
			start: { x: 40, y: height - 80 },
			end: { x: width - 40, y: height - 80 },
			thickness: 0.5,
			color: cBorder
		});

		// 2 — Informações do Documento (Apenas na primeira página de cada grupo)
		let currY = height - 105;
		const drawMetaData = (label: string, value: string, y: number, isBold = false) => {
			page.drawText(label + ':', { x: 40, y, size: 8, font: fontBold, color: cText });
			page.drawText(value || 'N/A', {
				x: 160,
				y,
				size: 8.5,
				font: isBold ? fontBold : font,
				color: cText
			});
			return y - 15;
		};

		currY = drawMetaData('Status', 'ASSINADO', currY, true);

		// Documento: nome pode ser longo — quebra antes de atingir o QR code (x ≈ width-105)
		{
			const docName = principal.documentName || 'Extraordinário - GISE';
			const maxW = width - 105 - 160 - 15; // espaço disponível antes do QR
			const nameW = font.widthOfTextAtSize(docName, 8.5);
			page.drawText('Documento:', { x: 40, y: currY, size: 8, font: fontBold, color: cText });
			if (nameW <= maxW) {
				page.drawText(docName, { x: 160, y: currY, size: 8.5, font, color: cText });
				currY -= 15;
			} else {
				// Quebra em palavras até caber na primeira linha
				const words = docName.split(' ');
				let line1 = '',
					line2 = '';
				for (const word of words) {
					const candidate = line1 ? line1 + ' ' + word : word;
					if (font.widthOfTextAtSize(candidate, 8.5) <= maxW) {
						line1 = candidate;
					} else {
						line2 = line2 ? line2 + ' ' + word : word;
					}
				}
				page.drawText(line1, { x: 160, y: currY, size: 8.5, font, color: cText });
				currY -= 11;
				page.drawText(line2, { x: 160, y: currY, size: 8.5, font, color: cText });
				currY -= 15;
			}
		}

		currY = drawMetaData('Identificador', principal.verificationHash, currY);

		// Hash SHA-256 — exibir completo em duas linhas quando disponível
		const hashReal =
			principal.documentHash &&
			principal.documentHash !== 'undefined' &&
			principal.documentHash !== 'N/A'
				? principal.documentHash
				: null;
		if (hashReal && hashReal.length > 32) {
			// Linha 1: primeiros 32 chars
			page.drawText('Hash do Original:', {
				x: 40,
				y: currY,
				size: 8,
				font: fontBold,
				color: cText
			});
			page.drawText(hashReal.slice(0, 32), {
				x: 160,
				y: currY,
				size: 7.5,
				font: fontMono,
				color: cText
			});
			currY -= 11;
			// Linha 2: restante
			page.drawText(hashReal.slice(32), {
				x: 160,
				y: currY,
				size: 7.5,
				font: fontMono,
				color: cText
			});
			currY -= 15;
		} else {
			currY = drawMetaData(
				'Hash do Original',
				hashReal ?? '(calculado no momento da assinatura)',
				currY
			);
		}

		// QR Code de Validação no canto superior direito
		if (principal.verificationUrl) {
			try {
				const qrSize = 65;
				const qr = QRCode.create(principal.verificationUrl, { errorCorrectionLevel: 'H' });
				const moduleCount = qr.modules.size;
				const dotSize = qrSize / moduleCount;
				for (let r = 0; r < moduleCount; r++) {
					for (let c = 0; c < moduleCount; c++) {
						if (qr.modules.get(r, c)) {
							page.drawRectangle({
								x: width - 105 + c * dotSize,
								y: height - 155 + (moduleCount - r - 1) * dotSize,
								width: dotSize + 0.1,
								height: dotSize + 0.1,
								color: cNavy
							});
						}
					}
				}
			} catch (err) {
				logger.warn('[pdf-signing] QR code de validação', { err: String(err) });
			}
		}

		page.drawLine({
			start: { x: 40, y: currY - 10 },
			end: { x: width - 40, y: currY - 10 },
			thickness: 0.5,
			color: cBorder
		});
		currY -= 40;

		// 3 — Seção de Assinaturas do Grupo (cartão estruturado).
		// Layout do cartão:
		//   [ header navy: badge + nome + data + token ]
		//   [ grid 2 colunas: 3 evidências cada      ]
		//   [ rúbrica   |   foto do ato (liveness)   ]   ← só p/ avançada
		for (let i = 0; i < group.signers.length; i++) {
			const s = group.signers[i];
			const isQualified = s.signatureLevel === 'qualificada';
			// Qualificada não tem rúbrica/foto → cartão mais baixo. Grid 2×2 (2 linhas;
			// +1 linha quando há e-mail). Avançada com e-mail ganha uma linha no grid.
			const boxH = isQualified ? (s.signerEmail ? 122 : 104) : s.signerEmail ? 262 : 240;

			if (currY - boxH < 90) {
				page = pdfDoc.addPage();
				const { height: nh } = page.getSize();
				page.drawText(`${group.title} (Continuação)`, {
					x: 40,
					y: nh - 50,
					size: 12,
					font: fontBold,
					color: cNavy
				});
				page.drawLine({
					start: { x: 40, y: nh - 80 },
					end: { x: width - 40, y: nh - 80 },
					thickness: 0.5,
					color: cBorder
				});
				currY = nh - 110;
			}

			const boxX = 40;
			const boxW = width - 80;
			const boxTop = currY;
			const boxBottom = boxTop - boxH;

			// Card branco com borda fina (substitui o cinza chapado anterior).
			page.drawRectangle({
				x: boxX,
				y: boxBottom,
				width: boxW,
				height: boxH,
				color: rgb(1, 1, 1),
				borderColor: cBorder,
				borderWidth: 1
			});

			// --- Header strip ---
			const headerH = 52;
			const headerColor = isQualified ? rgb(0.1, 0.3, 0.7) : cNavy;
			const headerTextSoft = rgb(0.82, 0.87, 1);
			page.drawRectangle({
				x: boxX,
				y: boxTop - headerH,
				width: boxW,
				height: headerH,
				color: headerColor
			});

			const badgeLabel = isQualified ? 'QUALIFICADA · ICP-BRASIL' : 'AVANÇADA · TELA/MOBILE';
			page.drawText(badgeLabel, {
				x: boxX + 15,
				y: boxTop - 14,
				size: 7,
				font: fontBold,
				color: headerTextSoft
			});

			page.drawText(s.signerName.toUpperCase(), {
				x: boxX + 15,
				y: boxTop - 32,
				size: 12,
				font: fontBold,
				color: rgb(1, 1, 1)
			});

			const dataAssinatura = new Intl.DateTimeFormat('pt-BR', {
				dateStyle: 'short',
				timeStyle: 'medium',
				timeZone: 'America/Sao_Paulo'
			}).format(s.signingTime);
			page.drawText(`Assinado em ${dataAssinatura}`, {
				x: boxX + 15,
				y: boxTop - 46,
				size: 8,
				font,
				color: headerTextSoft
			});

			// Token alinhado à direita no header (truncado p/ caber).
			const tokenFull = s.token || s.verificationHash;
			const tokenLabel = `Token  ${tokenFull.length > 28 ? tokenFull.slice(0, 28) + '...' : tokenFull}`;
			const tokenW = font.widthOfTextAtSize(tokenLabel, 7);
			page.drawText(tokenLabel, {
				x: boxX + boxW - 15 - tokenW,
				y: boxTop - 46,
				size: 7,
				font,
				color: headerTextSoft
			});

			// --- Grid de evidências (2 colunas, 3 linhas) ---
			const gridTopY = boxTop - headerH - 18;
			const colLeftX = boxX + 15;
			const colRightX = boxX + boxW / 2 + 5;
			const labelOffset = 78;
			const rowGap = 18;

			const drawField = (label: string, val: string, x: number, y: number) => {
				page.drawText(label, { x, y, size: 6.5, font: fontBold, color: cGray });
				page.drawText(val || 'N/A', {
					x: x + labelOffset,
					y,
					size: 8,
					font,
					color: cText
				});
			};

			const cpfTexto = s.signerCpf ? mascararCPF(s.signerCpf) : 'N/A';
			const ipTexto = s.ip || 'Desconhecido';
			const dispositivoTexto = parseUserAgent(s.userAgent || '');
			const carimboTexto = descreverTipoCarimbo(s.tipoCarimoTempo ?? 'servidor');
			const localizacaoTexto =
				s.latitude && s.longitude
					? `${s.latitude.toFixed(4)}, ${s.longitude.toFixed(4)}`
					: 'Não capturado';
			const livenessLabels: Record<string, string> = {
				blink: 'Piscar',
				smile: 'Sorrir',
				head_turn: 'Virar cabeça'
			};
			const livenessTexto = s.livenessChallenge
				? `${livenessLabels[s.livenessChallenge.tipo] ?? s.livenessChallenge.tipo} ${
						s.livenessChallenge.cumprido ? 'OK' : 'FALHOU'
					}${
						s.livenessChallenge.tentativas > 1
							? ` (${s.livenessChallenge.tentativas} tentativas)`
							: ''
					} - ${(s.livenessChallenge.duracaoMs / 1000).toFixed(1)}s`
				: 'Não exigida';

			if (isQualified) {
				// Grid 2×2 balanceado: sem evidências presenciais (rúbrica/foto/GPS/
				// liveness), as 4 informações da assinatura A3 distribuem-se simétricas.
				drawField('IDENTIFICAÇÃO', cpfTexto, colLeftX, gridTopY);
				drawField('IP', ipTexto, colLeftX, gridTopY - rowGap);
				drawField('DISPOSITIVO', dispositivoTexto, colRightX, gridTopY);
				drawField('CARIMBO DE TEMPO', carimboTexto, colRightX, gridTopY - rowGap);
				if (s.signerEmail) {
					drawField('E-MAIL', s.signerEmail, colLeftX, gridTopY - rowGap * 2);
				}
			} else {
				// Coluna esquerda
				drawField('IDENTIFICAÇÃO', cpfTexto, colLeftX, gridTopY);
				drawField('IP', ipTexto, colLeftX, gridTopY - rowGap);
				drawField('DISPOSITIVO', dispositivoTexto, colLeftX, gridTopY - rowGap * 2);

				// Coluna direita — evidências do ato presencial (tela/mobile).
				drawField('CARIMBO DE TEMPO', carimboTexto, colRightX, gridTopY);
				drawField('LOCALIZAÇÃO', localizacaoTexto, colRightX, gridTopY - rowGap);
				drawField('PROVA DE VIDA', livenessTexto, colRightX, gridTopY - rowGap * 2);

				// E-mail abaixo (largura total) se disponível
				if (s.signerEmail) {
					drawField('E-MAIL', s.signerEmail, colLeftX, gridTopY - rowGap * 3);
				}
			}

			// --- Bloco de evidências visuais (só assinaturas avançadas) ---
			if (!isQualified) {
				const sepY = gridTopY - rowGap * (s.signerEmail ? 4 : 3) - 6;
				page.drawLine({
					start: { x: boxX + 15, y: sepY },
					end: { x: boxX + boxW - 15, y: sepY },
					thickness: 0.5,
					color: cBorder
				});

				const evidLabelY = sepY - 14;
				// Rúbrica com a MESMA altura da foto (80) → frames alinhados (mesmo topo
				// e base, pois ambos partem de evidLabelY-6). Foto recuada ~20pt à esquerda.
				const rubW = 150,
					rubH = 80;
				const fotW = 60,
					fotH = 80;
				const rubX = boxX + 25;
				const fotX = boxX + boxW - 45 - fotW;

				// Rótulos
				page.drawText('RÚBRICA', {
					x: rubX,
					y: evidLabelY,
					size: 6.5,
					font: fontBold,
					color: cGray
				});
				page.drawText('FOTO DO ATO (LIVENESS)', {
					x: fotX,
					y: evidLabelY,
					size: 6.5,
					font: fontBold,
					color: cGray
				});

				// Frame rúbrica
				const rubFrameY = evidLabelY - 6 - rubH;
				page.drawRectangle({
					x: rubX,
					y: rubFrameY,
					width: rubW,
					height: rubH,
					color: rgb(0.99, 0.99, 0.99),
					borderColor: cBorder,
					borderWidth: 0.5
				});
				if (s.rubricBase64) {
					try {
						const img = s.rubricBase64.includes('image/jpeg')
							? await pdfDoc.embedJpg(s.rubricBase64)
							: await pdfDoc.embedPng(s.rubricBase64);
						const ratio = img.width / img.height;
						let iw = rubW - 12;
						let ih = iw / ratio;
						if (ih > rubH - 8) {
							ih = rubH - 8;
							iw = ih * ratio;
						}
						page.drawImage(img, {
							x: rubX + (rubW - iw) / 2,
							y: rubFrameY + (rubH - ih) / 2,
							width: iw,
							height: ih
						});
					} catch (err) {
						logger.warn('[pdf-signing] incorporar rúbrica no manifesto', { err: String(err) });
					}
				}

				// Frame foto (3:4)
				const fotFrameY = evidLabelY - 6 - fotH;
				page.drawRectangle({
					x: fotX,
					y: fotFrameY,
					width: fotW,
					height: fotH,
					color: rgb(0.99, 0.99, 0.99),
					borderColor: cBorder,
					borderWidth: 0.5
				});
				if (s.selfieBase64) {
					try {
						const data = s.selfieBase64.includes(',')
							? s.selfieBase64.split(',')[1]
							: s.selfieBase64;
						const bytes = Buffer.from(data, 'base64');
						const img = await pdfDoc.embedJpg(bytes);
						const ratio = img.width / img.height;
						// "Object cover" — preenche o frame, recorta o excesso.
						let iw = fotW - 4;
						let ih = iw / ratio;
						if (ih < fotH - 4) {
							ih = fotH - 4;
							iw = ih * ratio;
						}
						page.drawImage(img, {
							x: fotX + (fotW - iw) / 2,
							y: fotFrameY + (fotH - ih) / 2,
							width: iw,
							height: ih
						});
					} catch (err) {
						logger.warn('[pdf-signing] incorporar selfie no manifesto', { err: String(err) });
					}
				}
			}

			currY -= boxH + 18;
		}

		// Rodapé de Compliance
		const hasQualified = group.signers.some((s) => s.signatureLevel === 'qualificada');
		const footerY = 60;
		if (hasQualified) {
			page.drawText('INTEGRIDADE CERTIFICADA - ICP-BRASIL', {
				x: 40,
				y: footerY + 25,
				size: 10,
				font: fontBold,
				color: cText
			});
			page.drawText(
				'Assinaturas eletrônicas têm igual validade legal conforme MP 2.200-2/2001 e Lei 14.063/2020.',
				{ x: 40, y: footerY + 12, size: 7, font, color: cGray }
			);
		} else {
			page.drawText('VALIDADE JURÍDICA ASSEGURADA - LEI 14.063/20', {
				x: 40,
				y: footerY + 25,
				size: 10,
				font: fontBold,
				color: cText
			});
			page.drawText(
				'Este documento utiliza assinaturas eletrônicas avançadas com plena eficácia probatória.',
				{ x: 40, y: footerY + 12, size: 7, font, color: cGray }
			);
		}
		const hashTrunc = principal.documentHash ? principal.documentHash.slice(0, 16) + '...' : '';
		page.drawText(`Manifesto vinculado ao documento de hash ${hashTrunc}`, {
			x: 40,
			y: footerY,
			size: 8,
			font: fontMono,
			color: cGray
		});
	}

	return pdfDoc.save();
}

// ---------------------------------------------------------------------------
// Rodapé Universal em Todas as Páginas de Conteúdo
// ---------------------------------------------------------------------------

interface RodapeUniversalOptions {
	/** Hash SHA-256 do PDF original */
	documentHash: string;
	/** URL completa de validação (ex: https://escalas.pages.dev/validar/XXXX) */
	verificationUrl: string;
	/** Código de verificação curto (ex: B48T-4N22) */
	verificationHash: string;
	/** Índice da última página de conteúdo (0-based). A página seguinte é a de auditoria. */
	contentPageCount?: number;
	/**
	 * Nome do signatário. Quando presente, a ÚLTIMA página de conteúdo (onde vai o
	 * campo de assinatura) recebe um bloco de identidade com QR de validação +
	 * "Assinado digitalmente por: NOME" + matrícula/data/código/URL. É aqui que a
	 * identidade passa a viver quando o carimbo usa o estilo `'rubrica'` (campo só
	 * com a rubrica). Sem ele, o rodapé mantém apenas hash + base legal.
	 */
	signerName?: string;
	/** Matrícula do signatário, exibida ao lado do nome (ex.: "301.095-1-1"). */
	signerMatricula?: string;
	/** ISO 8601 da assinatura — exibida como DATA (sem horário) no fuso -03. */
	signedAtISO?: string;
	/** Rótulo da identidade (default "Assinado digitalmente por"). */
	signatureLabel?: string;
}

/** Formata um ISO como DD/MM/AAAA no fuso de Brasília (UTC-3), sem horário. */
function formatarDataBR(iso?: string): string {
	const d = iso ? new Date(iso) : new Date();
	if (isNaN(d.getTime())) return '';
	const br = new Date(d.getTime() - 3 * 3600 * 1000);
	return `${String(br.getUTCDate()).padStart(2, '0')}/${String(br.getUTCMonth() + 1).padStart(2, '0')}/${br.getUTCFullYear()}`;
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
	const { documentHash, contentPageCount, signerName, verificationHash, verificationUrl } = options;

	const pdfDoc = await PDFDocument.load(pdfBytes);
	const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
	const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
	const fontMono = await pdfDoc.embedFont(StandardFonts.Courier);

	const cGray = rgb(0.55, 0.55, 0.6);
	const cDark = rgb(0.1, 0.14, 0.28);
	const cLightLine = rgb(0.8, 0.85, 0.92);

	const pages = pdfDoc.getPages();
	// Aplica em todas as páginas, ou apenas nas de conteúdo (exclui folha de auditoria)
	const lastContentIdx = contentPageCount !== undefined ? contentPageCount - 1 : pages.length - 1;

	const hashAbrev = documentHash ? documentHash.slice(0, 16) + '...' + documentHash.slice(-8) : '';

	const legalText = 'Assinatura Eletrônica — Lei 14.063/2020';

	for (let i = 0; i <= lastContentIdx; i++) {
		const page = pages[i];
		const { width } = page.getSize();
		const footerY = 18;
		// Na página do campo de assinatura, a esquerda do rodapé é ocupada pelo
		// bloco de identidade + QR; então SHA-256 e base legal vão juntos à direita
		// e o separador é omitido (cruzaria o bloco). Nas demais, rodapé fino padrão.
		const ehPaginaAssinatura = !!signerName && i === lastContentIdx;

		if (ehPaginaAssinatura) {
			const linha = `SHA-256: ${hashAbrev}  ·  ${legalText}`;
			const w =
				fontMono.widthOfTextAtSize(`SHA-256: ${hashAbrev}  ·  `, 5.5) +
				font.widthOfTextAtSize(legalText, 5.5);
			page.drawText(linha, {
				x: width - w - 20,
				y: footerY,
				size: 5.5,
				font: fontMono,
				color: cGray
			});
			continue;
		}

		// Linha separadora
		page.drawLine({
			start: { x: 20, y: footerY + 10 },
			end: { x: width - 20, y: footerY + 10 },
			thickness: 0.3,
			color: cLightLine
		});
		// Hash abreviado (esquerda)
		page.drawText(`SHA-256: ${hashAbrev}`, {
			x: 20,
			y: footerY,
			size: 5.5,
			font: fontMono,
			color: cGray
		});
		// Base legal (direita)
		const legalW = font.widthOfTextAtSize(legalText, 5.5);
		page.drawText(legalText, {
			x: width - legalW - 20,
			y: footerY,
			size: 5.5,
			font,
			color: cGray
		});
	}

	// Bloco de identidade + QR na página do campo de assinatura (estilo 'rubrica'):
	// como o campo agora carrega SÓ a rubrica, o "Assinado digitalmente por…", o
	// código e o QR de validação passam a viver aqui, no canto inferior esquerdo.
	// COMPACTO (QR ~33pt, y 18..51) para caber abaixo da linha "cidade, data" que a
	// própria escala imprime no rodapé (~y 57 quando a assinatura fica no pé).
	if (signerName) {
		const page = pages[lastContentIdx];
		const label = options.signatureLabel ?? 'Assinado digitalmente por';
		const qrSize = 33;
		const qrX = 20;
		const qrY = 17;

		if (verificationUrl) {
			try {
				const qr = QRCode.create(verificationUrl, { errorCorrectionLevel: 'M' });
				const moduleCount = qr.modules.size;
				const dot = qrSize / moduleCount;
				page.drawRectangle({
					x: qrX - 1.5,
					y: qrY - 1.5,
					width: qrSize + 3,
					height: qrSize + 3,
					color: rgb(1, 1, 1)
				});
				for (let row = 0; row < moduleCount; row++) {
					for (let col = 0; col < moduleCount; col++) {
						if (qr.modules.get(row, col)) {
							page.drawRectangle({
								x: qrX + col * dot,
								y: qrY + (moduleCount - row - 1) * dot,
								width: dot + 0.1,
								height: dot + 0.1,
								color: rgb(0, 0, 0)
							});
						}
					}
				}
			} catch (err) {
				logger.error('Erro ao gerar QR no rodapé de identidade', {
					error: err instanceof Error ? err.message : String(err)
				});
			}
		}

		// Bloco de texto (5 linhas) ao lado do QR.
		const tx = qrX + qrSize + 8;
		page.drawText(`${label}:`, { x: tx, y: 47, size: 5.5, font, color: cGray });

		const mat = options.signerMatricula ? ` - Mat.: ${options.signerMatricula}` : '';
		page.drawText(`${signerName.toUpperCase()}${mat}`, {
			x: tx,
			y: 39,
			size: 7,
			font: fontBold,
			color: cDark
		});

		const dataAss = formatarDataBR(options.signedAtISO);
		page.drawText(`Assinado em ${dataAss} – MP 2.200-2/2001 – ICP Brasil`, {
			x: tx,
			y: 31.5,
			size: 5,
			font,
			color: cGray
		});

		if (verificationHash) {
			page.drawText(`Código verificador: ${verificationHash}`, {
				x: tx,
				y: 24.5,
				size: 5.5,
				font: fontMono,
				color: cGray
			});
		}

		if (verificationUrl) {
			const cleanUrl = verificationUrl.replace(/^https?:\/\//, '');
			page.drawText(`Validar em ${cleanUrl}`, { x: tx, y: 18, size: 5, font, color: cGray });
		}
	}

	return pdfDoc.save();
}
