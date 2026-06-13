/**
 * Utilitário para exportar gráficos Chart.js e rankings como imagens PNG.
 * Centraliza a criação de canvas off-screen com header/footer padronizado.
 */

interface ChartExportConfig {
	label: string;
	color: string;
	sourceCanvas?: HTMLCanvasElement | null;
	type: 'chart' | 'ranking' | 'detail';
}

export interface RankingItem {
	nome: string;
	total: number;
}

export interface DetailItem {
	label: string;
	value: number;
}

const PADDING = 40;
const HEADER_HEIGHT = 120;
const FOOTER_HEIGHT = 40;
const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 600;

function createBaseCanvas(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
	const canvas = document.createElement('canvas');
	canvas.width = CANVAS_WIDTH + PADDING * 2;
	canvas.height = CANVAS_HEIGHT + HEADER_HEIGHT + FOOTER_HEIGHT;
	const ctx = canvas.getContext('2d')!;
	return { canvas, ctx };
}

function drawHeader(
	ctx: CanvasRenderingContext2D,
	label: string,
	color: string,
	seccionalName: string,
	periodText: string,
	width: number
) {
	// Background branco
	ctx.fillStyle = 'white';
	ctx.fillRect(0, 0, width, CANVAS_HEIGHT + HEADER_HEIGHT + FOOTER_HEIGHT);

	// Título
	ctx.fillStyle = color;
	ctx.font = 'bold 24px Inter, sans-serif, Arial';
	ctx.fillText(label.toUpperCase(), PADDING, 50);

	// Seccional e período
	ctx.fillStyle = '#64748b';
	ctx.font = 'bold 14px Inter, sans-serif, Arial';
	ctx.fillText(`SECCIONAL: ${seccionalName.toUpperCase()}`, PADDING, 80);
	ctx.fillText(`PERÍODO: ${periodText}`, PADDING, 100);

	// Linha separadora
	ctx.strokeStyle = '#e2e8f0';
	ctx.lineWidth = 1;
	ctx.beginPath();
	ctx.moveTo(PADDING, HEADER_HEIGHT - 10);
	ctx.lineTo(width - PADDING, HEADER_HEIGHT - 10);
	ctx.stroke();
}

function drawFooter(ctx: CanvasRenderingContext2D, width: number) {
	ctx.textAlign = 'right';
	ctx.fillStyle = '#94a3b8';
	ctx.font = 'bold 10px Inter';
	ctx.fillText(
		'GISE - DASHBOARD DE PRODUTIVIDADE',
		width - PADDING,
		CANVAS_HEIGHT + HEADER_HEIGHT + FOOTER_HEIGHT - 15
	);
}

function drawRanking(
	ctx: CanvasRenderingContext2D,
	ranking: RankingItem[],
	color: string,
	unit: string
) {
	let y = HEADER_HEIGHT + 20;

	ranking.slice(0, 10).forEach((item, idx) => {
		ctx.beginPath();
		ctx.fillStyle = '#f8fafc';
		if (ctx.roundRect) {
			ctx.roundRect(PADDING, y, CANVAS_WIDTH - PADDING * 2, 40, 8);
		} else {
			ctx.rect(PADDING, y, CANVAS_WIDTH - PADDING * 2, 40);
		}
		ctx.fill();

		ctx.fillStyle = '#94a3b8';
		ctx.font = 'italic bold 16px Inter';
		ctx.fillText(`#${idx + 1}`, PADDING + 15, y + 26);

		ctx.fillStyle = '#1e293b';
		ctx.font = 'bold 14px Inter';
		ctx.fillText(item.nome.toUpperCase(), PADDING + 60, y + 26);

		ctx.textAlign = 'right';
		ctx.fillStyle = color;
		ctx.font = 'black 18px Inter';
		const val = unit === 'kg' ? (item.total / 1000).toFixed(1) : item.total;
		ctx.fillText(`${val}${unit}`, CANVAS_WIDTH - PADDING - 15, y + 26);
		ctx.textAlign = 'left';

		y += 45;
	});
}

function drawDetail(
	ctx: CanvasRenderingContext2D,
	details: DetailItem[],
	total: number,
	color: string,
	unit: string
) {
	let y = HEADER_HEIGHT + 20;

	details.forEach(({ label, value }) => {
		ctx.fillStyle = '#64748b';
		ctx.font = 'bold 12px Inter';
		ctx.fillText(label.toUpperCase(), PADDING, y);

		ctx.textAlign = 'right';
		ctx.fillStyle = color;
		const displayVal =
			unit === 'g' && value >= 1000 ? `${(value / 1000).toFixed(1)}kg` : `${value}${unit}`;
		ctx.fillText(displayVal, CANVAS_WIDTH - PADDING, y);
		ctx.textAlign = 'left';

		// Barra de fundo
		ctx.fillStyle = '#f1f5f9';
		ctx.beginPath();
		if (ctx.roundRect) {
			ctx.roundRect(PADDING, y + 10, CANVAS_WIDTH - PADDING * 2, 12, 6);
		} else {
			ctx.rect(PADDING, y + 10, CANVAS_WIDTH - PADDING * 2, 12);
		}
		ctx.fill();

		// Barra colorida
		ctx.fillStyle = color;
		ctx.beginPath();
		const w = (value / (total || 1)) * (CANVAS_WIDTH - PADDING * 2);
		if (ctx.roundRect) {
			ctx.roundRect(PADDING, y + 10, Math.max(w, 4), 12, 6);
		} else {
			ctx.rect(PADDING, y + 10, Math.max(w, 4), 12);
		}
		ctx.fill();

		y += 50;
	});
}

/**
 * Virtual chart configs para rankings e detalhamentos
 */
export const VIRTUAL_CHARTS: Record<
	string,
	{ label: string; color: string; type: 'ranking' | 'detail' }
> = {
	'rank-prisoes': { label: 'Ranking de Prisões (P7)', color: '#f43f5e', type: 'ranking' },
	'detail-prisoes': { label: 'Detalhamento de Prisões', color: '#f43f5e', type: 'detail' },
	'rank-drogas': { label: 'Ranking de Drogas (P10)', color: '#ef4444', type: 'ranking' },
	'detail-drogas': { label: 'Detalhamento de Substâncias', color: '#ef4444', type: 'detail' },
	'rank-armas': { label: 'Ranking de Armas (P11)', color: '#6366f1', type: 'ranking' },
	'detail-armas': { label: 'Detalhamento de Armas', color: '#6366f1', type: 'detail' }
};

interface ExportPayload {
	seccionalName: string;
	periodText: string;
}

/**
 * Cria um blob PNG a partir de um canvas e dispara download.
 */
export async function downloadCanvas(canvas: HTMLCanvasElement, filename: string) {
	const link = document.createElement('a');
	link.download = filename;
	link.href = canvas.toDataURL('image/png');
	link.click();
	await new Promise((r) => setTimeout(r, 100));
}

/**
 * Exporta um gráfico Chart.js como PNG.
 */
export function exportChartAsPng(
	config: ChartExportConfig,
	payload: ExportPayload
): { canvas: HTMLCanvasElement; filename: string } {
	const { canvas, ctx } = createBaseCanvas();

	drawHeader(
		ctx,
		config.label,
		config.color,
		payload.seccionalName,
		payload.periodText,
		canvas.width
	);

	if (config.sourceCanvas) {
		ctx.drawImage(config.sourceCanvas, PADDING, HEADER_HEIGHT);
	}

	drawFooter(ctx, canvas.width);

	const filename = `GISE_${config.label.replace(/\s+/g, '_')}.png`;
	return { canvas, filename };
}

/**
 * Exporta um ranking como PNG.
 */
export function exportRankingAsPng(
	label: string,
	color: string,
	ranking: RankingItem[],
	unit: string,
	payload: ExportPayload
): { canvas: HTMLCanvasElement; filename: string } {
	const { canvas, ctx } = createBaseCanvas();

	drawHeader(ctx, label, color, payload.seccionalName, payload.periodText, canvas.width);
	drawRanking(ctx, ranking, color, unit);
	drawFooter(ctx, canvas.width);

	const filename = `GISE_${label.replace(/\s+/g, '_')}.png`;
	return { canvas, filename };
}

/**
 * Exporta um detalhamento como PNG.
 */
export function exportDetailAsPng(
	label: string,
	color: string,
	details: DetailItem[],
	total: number | undefined,
	unit: string,
	payload: ExportPayload
): { canvas: HTMLCanvasElement; filename: string } {
	const { canvas, ctx } = createBaseCanvas();

	drawHeader(ctx, label, color, payload.seccionalName, payload.periodText, canvas.width);
	drawDetail(ctx, details, total || 0, color, unit);
	drawFooter(ctx, canvas.width);

	const filename = `GISE_${label.replace(/\s+/g, '_')}.png`;
	return { canvas, filename };
}
