/**
 * O QR de validação desenhado nos PDFs assinados, em fonte única.
 *
 * A biblioteca `qrcode` entrega uma MATRIZ de módulos, não uma imagem: quem
 * desenha em `pdf-lib` precisa converter linha/coluna em coordenada de página, e
 * é aí que mora a armadilha. O eixo Y do PDF cresce PARA CIMA e a matriz é
 * indexada de cima para baixo, então a linha `row` tem de virar
 * `(moduleCount - row - 1)`. Errar esse termo produz um QR espelhado na
 * vertical — que continua parecendo um QR e simplesmente não lê. O documento sai
 * assinado, impresso e arquivado com um código morto.
 *
 * O `+ 0.1` na largura/altura de cada módulo também não é folga arbitrária: sem
 * ele o arredondamento do renderizador deixa fios de fundo branco entre os
 * quadrados, e o contraste cai abaixo do que a câmera de um celular resolve.
 *
 * Os quatro carimbos que usam isto (rodapé simples, página de auditoria, bloco
 * de identidade e a caixa de assinatura de `pdf-signing-prepare`) diferem só em
 * posição, tamanho, cor e nível de correção de erro — a geometria é a mesma, e
 * era copiada quatro vezes.
 *
 * Falha de geração NUNCA aborta a assinatura: o documento vale sem o QR, e
 * derrubar o fluxo de assinatura por um adorno seria pior que a ausência dele.
 * Daí o `try`/`catch` viver aqui dentro, e não em cada chamador.
 *
 * Coberto por `pdf-goldens` — mexer aqui muda bytes de PDF assinado.
 */
import type { PDFPage, Color } from 'pdf-lib';
import * as QRCode from 'qrcode';
import { logger } from '../logger';

export interface QrCodeOptions {
	/** URL de validação codificada no código. */
	url: string;
	/** Canto INFERIOR esquerdo, em pontos (origem do `pdf-lib`). */
	x: number;
	y: number;
	/** Lado do quadrado, em pontos. */
	tamanho: number;
	/** Cor dos módulos escuros. */
	cor: Color;
	/**
	 * Nível de correção de erro. `'H'` (~30% de redundância) é o padrão porque
	 * os carimbos são lidos por câmera de celular sobre papel impresso; `'M'` só
	 * onde o espaço obriga a um QR menor.
	 */
	correcao?: 'L' | 'M' | 'Q' | 'H';
	/** Retângulo de respaldo atrás do código. Omitir = desenhar direto no fundo. */
	fundo?: { cor: Color; margem: number };
	/** Identifica o carimbo na mensagem de log quando a geração falha. */
	contexto: string;
}

/**
 * Desenha o QR na página. Não lança: registra e segue.
 *
 * O chamador não precisa de `try`/`catch` — e não deve adicionar um, porque a
 * decisão de "documento sem QR é melhor que assinatura abortada" é desta
 * função.
 */
export function desenharQrCode(page: PDFPage, opts: QrCodeOptions): void {
	const { url, x, y, tamanho, cor, correcao = 'H', fundo, contexto } = opts;
	if (!url) return;

	try {
		const qr = QRCode.create(url, { errorCorrectionLevel: correcao });
		const moduleCount = qr.modules.size;
		const dot = tamanho / moduleCount;

		if (fundo) {
			page.drawRectangle({
				x: x - fundo.margem,
				y: y - fundo.margem,
				width: tamanho + fundo.margem * 2,
				height: tamanho + fundo.margem * 2,
				color: fundo.cor
			});
		}

		for (let row = 0; row < moduleCount; row++) {
			for (let col = 0; col < moduleCount; col++) {
				if (!qr.modules.get(row, col)) continue;
				page.drawRectangle({
					x: x + col * dot,
					// Inversão do eixo Y: a matriz desce, a página sobe.
					y: y + (moduleCount - row - 1) * dot,
					// Sobreposição mínima para não deixar fresta entre os módulos.
					width: dot + 0.1,
					height: dot + 0.1,
					color: cor
				});
			}
		}
	} catch (err: unknown) {
		logger.error('Erro ao gerar QR Code de validação', {
			contexto,
			error: err instanceof Error ? err.message : String(err)
		});
	}
}
