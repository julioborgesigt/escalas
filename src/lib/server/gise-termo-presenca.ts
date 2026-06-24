/**
 * Gera o "Termo de Confirmação de Presença" (entrada/saída) da GISE em PDF,
 * para assinatura por Token A3 no computador. É um documento de UMA página; a
 * rubrica cadastrada e o carimbo de verificação são adicionados depois, por
 * `prepararPdfParaAssinatura`, usando o `signatureLineY` devolvido aqui.
 *
 * Mantém-se enxuto de propósito: a força jurídica vem da assinatura qualificada
 * (CAdES-LT/PAdES) embutida, não do layout.
 */

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { mascararCPF } from '../utils';

export interface TermoPresencaInput {
	tipo: 'entrada' | 'saida';
	signerName: string;
	signerCpf?: string | null;
	matricula?: string | null;
	giseId: number;
	/** Data da escala GISE (YYYY-MM-DD). */
	dataInicio: string;
	unidadeNome?: string | null;
	/** Momento da confirmação (ISO). */
	timestampISO: string;
}

function formatarDataBR(yyyatmmdd: string): string {
	const [y, m, d] = yyyatmmdd.split('-');
	if (!y || !m || !d) return yyyatmmdd;
	return `${d}/${m}/${y}`;
}

/** Quebra um texto em linhas que cabem em `maxWidth` (pts) na fonte/tamanho dados. */
function wrap(
	texto: string,
	font: import('pdf-lib').PDFFont,
	size: number,
	maxWidth: number
): string[] {
	const palavras = texto.split(/\s+/);
	const linhas: string[] = [];
	let atual = '';
	for (const p of palavras) {
		const tentativa = atual ? `${atual} ${p}` : p;
		if (font.widthOfTextAtSize(tentativa, size) > maxWidth && atual) {
			linhas.push(atual);
			atual = p;
		} else {
			atual = tentativa;
		}
	}
	if (atual) linhas.push(atual);
	return linhas;
}

export async function gerarTermoPresencaPdf(
	input: TermoPresencaInput
): Promise<{ pdf: Uint8Array; signatureLineY: number }> {
	const doc = await PDFDocument.create();
	const page = doc.addPage([595.28, 841.89]); // A4 em pts
	const { width, height } = page.getSize();
	const font = await doc.embedFont(StandardFonts.Helvetica);
	const bold = await doc.embedFont(StandardFonts.HelveticaBold);

	const navy = rgb(0.07, 0.14, 0.42);
	const text = rgb(0.1, 0.1, 0.15);
	const gray = rgb(0.4, 0.4, 0.45);
	const margin = 56;
	const contentW = width - 2 * margin;

	const acao = input.tipo === 'entrada' ? 'ENTRADA' : 'SAÍDA';

	// Cabeçalho
	page.drawRectangle({ x: 0, y: height - 92, width, height: 92, color: navy });
	page.drawText('TERMO DE CONFIRMAÇÃO DE PRESENÇA', {
		x: margin,
		y: height - 50,
		size: 16,
		font: bold,
		color: rgb(1, 1, 1)
	});
	page.drawText('Grupo de Intensificação e Saturação Especial (GISE)', {
		x: margin,
		y: height - 72,
		size: 10,
		font,
		color: rgb(0.85, 0.88, 0.95)
	});

	// Campos
	let y = height - 130;
	const campo = (rotulo: string, valor: string) => {
		page.drawText(rotulo, { x: margin, y, size: 8.5, font: bold, color: gray });
		page.drawText(valor || '—', { x: margin, y: y - 15, size: 12, font, color: text });
		y -= 42;
	};

	const dt = new Date(input.timestampISO);
	const dataHora = isNaN(dt.getTime()) ? input.timestampISO : dt.toLocaleString('pt-BR');

	campo('TIPO DE REGISTRO', `Confirmação de ${acao} no serviço`);
	campo('SERVIDOR', input.signerName);
	campo('MATRÍCULA', input.matricula || '—');
	campo('CPF', input.signerCpf ? mascararCPF(input.signerCpf) : '—');
	campo('ESCALA GISE', `#${input.giseId} — ${formatarDataBR(input.dataInicio)}`);
	if (input.unidadeNome) campo('UNIDADE', input.unidadeNome);
	campo('DATA/HORA DA CONFIRMAÇÃO', dataHora);

	// Declaração
	y -= 6;
	const declaracao =
		`Declaro, para os devidos fins e sob as penas da lei, a veracidade do registro de ${acao.toLowerCase()} ` +
		`no serviço acima identificado, confirmado de forma eletrônica por mim, mediante assinatura digital ` +
		`qualificada (certificado ICP-Brasil, Token A3), nos termos da MP 2.200-2/2001 e da Lei 14.063/2020.`;
	for (const linha of wrap(declaracao, font, 10.5, contentW)) {
		page.drawText(linha, { x: margin, y, size: 10.5, font, color: text });
		y -= 16;
	}

	// Linha de assinatura (a rubrica cadastrada e o carimbo são estampados depois)
	const signatureLineY = 150;
	page.drawLine({
		start: { x: margin, y: signatureLineY },
		end: { x: width - margin, y: signatureLineY },
		thickness: 1,
		color: gray
	});
	page.drawText(`${input.signerName} — Assinatura Digital Qualificada (ICP-Brasil)`, {
		x: margin,
		y: signatureLineY - 14,
		size: 9,
		font,
		color: gray
	});

	const pdf = await doc.save();
	return { pdf, signatureLineY };
}
