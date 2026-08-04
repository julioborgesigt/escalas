/**
 * A GEOMETRIA do QR de validação — a única parte do carimbo que falha em
 * silêncio.
 *
 * Um QR espelhado na vertical continua parecendo um QR: sai no PDF, é impresso,
 * assinado e arquivado, e só não lê. Nenhuma revisão visual pega isso, e os
 * `pdf-goldens` não cobrem estes desenhos (eles cobrem `export/pdf.ts`, que não
 * passa pelos carimbos de assinatura). Daí a verificação ser aqui, sobre a
 * matriz reconstruída a partir dos retângulos desenhados.
 *
 * O teste não confere pixels: reconstrói a matriz do que foi desenhado na página
 * e compara com a que a biblioteca `qrcode` produziu. Se o mapeamento
 * linha/coluna → x/y errar em qualquer termo — inversão de eixo, transposição,
 * deslocamento —, a comparação acusa.
 */
import { describe, it, expect, vi } from 'vitest';
import { rgb, type PDFPage } from 'pdf-lib';
import * as QRCode from 'qrcode';
import { desenharQrCode } from '../pdf-qr';

vi.mock('../../logger', () => ({
	logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }
}));

type Ret = { x: number; y: number; width: number; height: number };

/** `PDFPage` falsa que só anota os retângulos pedidos. */
function paginaFalsa() {
	const rects: Ret[] = [];
	const page = {
		drawRectangle: (o: Ret) => rects.push(o)
	} as unknown as PDFPage;
	return { page, rects };
}

const URL_TESTE = 'https://escalas.pages.dev/validar/ABC123';
const PRETO = rgb(0, 0, 0);

/**
 * Refaz o caminho inverso do desenho: de retângulos na página para matriz.
 * Se `desenharQrCode` estiver correto, o resultado é a matriz original.
 */
function matrizDesenhada(rects: Ret[], x0: number, y0: number, tamanho: number, n: number) {
	const dot = tamanho / n;
	const m: boolean[][] = Array.from({ length: n }, () => Array(n).fill(false));
	for (const r of rects) {
		const col = Math.round((r.x - x0) / dot);
		const linhaDeBaixo = Math.round((r.y - y0) / dot);
		m[n - linhaDeBaixo - 1][col] = true;
	}
	return m;
}

describe('desenharQrCode', () => {
	it('reproduz a matriz da biblioteca, com o eixo Y invertido', () => {
		const { page, rects } = paginaFalsa();
		desenharQrCode(page, {
			url: URL_TESTE,
			x: 100,
			y: 50,
			tamanho: 60,
			cor: PRETO,
			contexto: 'teste'
		});

		const qr = QRCode.create(URL_TESTE, { errorCorrectionLevel: 'H' });
		const n = qr.modules.size;
		const esperada = Array.from({ length: n }, (_, row) =>
			Array.from({ length: n }, (_, col) => Boolean(qr.modules.get(row, col)))
		);

		expect(rects.length).toBe(esperada.flat().filter(Boolean).length);
		expect(matrizDesenhada(rects, 100, 50, 60, n)).toEqual(esperada);
	});

	it('põe a PRIMEIRA linha da matriz no TOPO do quadrado', () => {
		// O invariante que separa um QR legível de um espelhado. Escrito à parte
		// porque é a asserção que alguém precisa ler ao mexer na fórmula.
		const { page, rects } = paginaFalsa();
		const tamanho = 100;
		desenharQrCode(page, { url: URL_TESTE, x: 0, y: 0, tamanho, cor: PRETO, contexto: 'teste' });

		const qr = QRCode.create(URL_TESTE, { errorCorrectionLevel: 'H' });
		const n = qr.modules.size;
		const dot = tamanho / n;

		// Não basta olhar o canto: as duas pontas do eixo trazem um quadrado
		// localizador, então um QR espelhado ainda teria módulo no topo e na
		// esquerda. O que distingue é a LINHA INTEIRA — a matriz de um QR não é
		// simétrica na vertical, porque só três dos quatro cantos têm localizador.
		const topo = Math.max(...rects.map((r) => r.y));
		expect(topo).toBeCloseTo((n - 1) * dot, 6);

		const colunasNoTopo = rects
			.filter((r) => Math.abs(r.y - topo) < 1e-9)
			.map((r) => Math.round(r.x / dot))
			.sort((a, b) => a - b);
		const colunasDaLinha0 = [...Array(n).keys()].filter((col) => qr.modules.get(0, col));
		expect(colunasNoTopo).toEqual(colunasDaLinha0);

		const colunasDaUltimaLinha = [...Array(n).keys()].filter((col) => qr.modules.get(n - 1, col));
		expect(colunasDaLinha0).not.toEqual(colunasDaUltimaLinha);
	});

	it('cobre exatamente o lado pedido, com sobreposição mínima entre módulos', () => {
		const { page, rects } = paginaFalsa();
		desenharQrCode(page, { url: URL_TESTE, x: 10, y: 10, tamanho: 42, cor: PRETO, contexto: 't' });

		const n = QRCode.create(URL_TESTE, { errorCorrectionLevel: 'H' }).modules.size;
		const dot = 42 / n;
		// Sem o + 0.1 aparecem fios de fundo entre os quadrados e a câmera perde
		// o contraste; com folga maior os módulos claros somem.
		expect(rects[0].width).toBeCloseTo(dot + 0.1, 10);
		expect(rects[0].height).toBeCloseTo(dot + 0.1, 10);
		const direita = Math.max(...rects.map((r) => r.x));
		expect(direita).toBeLessThanOrEqual(10 + 42);
	});

	it('desenha o fundo ANTES dos módulos, senão ele os apagaria', () => {
		const { page, rects } = paginaFalsa();
		desenharQrCode(page, {
			url: URL_TESTE,
			x: 20,
			y: 30,
			tamanho: 40,
			cor: PRETO,
			fundo: { cor: rgb(1, 1, 1), margem: 2 },
			contexto: 'teste'
		});

		expect(rects[0]).toMatchObject({ x: 18, y: 28, width: 44, height: 44 });
	});

	it('sem `fundo`, não desenha respaldo nenhum', () => {
		const { page, rects } = paginaFalsa();
		const n = QRCode.create(URL_TESTE, { errorCorrectionLevel: 'H' }).modules.size;
		desenharQrCode(page, { url: URL_TESTE, x: 0, y: 0, tamanho: 40, cor: PRETO, contexto: 't' });

		const dot = 40 / n;
		expect(rects.every((r) => r.width < dot + 1)).toBe(true);
	});

	it('URL vazia não desenha nada — o carimbo sai sem QR, e não quebrado', () => {
		const { page, rects } = paginaFalsa();
		desenharQrCode(page, { url: '', x: 0, y: 0, tamanho: 40, cor: PRETO, contexto: 'teste' });
		expect(rects).toEqual([]);
	});

	it('falha de geração não sobe: assinatura não pode abortar por causa do QR', () => {
		const { page, rects } = paginaFalsa();
		// Excede a capacidade máxima de um QR (~2953 bytes) — a biblioteca lança.
		const gigante = 'x'.repeat(5000);
		expect(() =>
			desenharQrCode(page, { url: gigante, x: 0, y: 0, tamanho: 40, cor: PRETO, contexto: 'teste' })
		).not.toThrow();
		expect(rects).toEqual([]);
	});

	it("correção 'M' produz uma matriz menor que 'H' para a mesma URL", () => {
		// Justifica o único call site que pede 'M': com 33pt de lado, a matriz
		// mais densa de 'H' deixaria o módulo perto de sub-pixel na impressão.
		const nM = QRCode.create(URL_TESTE, { errorCorrectionLevel: 'M' }).modules.size;
		const nH = QRCode.create(URL_TESTE, { errorCorrectionLevel: 'H' }).modules.size;
		expect(nM).toBeLessThan(nH);
	});
});
