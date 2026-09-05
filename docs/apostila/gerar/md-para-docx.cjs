/**
 * Conversor Markdown -> DOCX (docx-js) feito sob medida para a apostila.
 * Suporta: capa, TOC, H1-H4, parágrafos com **negrito** `código` *itálico*
 * [link](url), listas (- e 1.), tabelas pipe, blocos de código, citações e ---.
 */
const fs = require('fs');
const {
	Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, PageBreak,
	Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle, TableOfContents,
	Header, Footer, PageNumber, ExternalHyperlink, LevelFormat, convertInchesToTwip
} = require('docx');

const SRC = process.argv[2];
const OUT = process.argv[3];
if (!SRC || !OUT) {
	console.error('uso: node docs/apostila/gerar/md-para-docx.cjs <entrada.md> <saida.docx>');
	process.exit(1);
}
const raw = fs.readFileSync(SRC, 'utf8');

// ---------- metadados da capa ----------
const meta = {};
const linhas = raw.split('\n');
let i = 0;
for (; i < linhas.length; i++) {
	const m = linhas[i].match(/^%%(\w+)%%\s*(.*)$/);
	if (!m) break;
	meta[m[1]] = m[2];
}
const corpo = linhas.slice(i).join('\n');

const CONTENT_WIDTH = 9638; // A4 (11906) - margens de 2cm (1134 x2)
const AZUL = '1F3864';
const CINZA_CODIGO = 'F2F2F2';
const CINZA_CABEC = 'D9E2F3';

// ---------- inline ----------
function inline(texto, base = {}) {
	const runs = [];
	// tokeniza: `code` | **bold** | *italic* | [txt](url)
	const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\([^)]+\))|(\*[^*\n]+\*)/g;
	let pos = 0, m;
	const push = (t, extra = {}) => {
		if (t === '') return;
		runs.push(new TextRun({ text: t, ...base, ...extra }));
	};
	while ((m = re.exec(texto)) !== null) {
		push(texto.slice(pos, m.index));
		const tok = m[0];
		if (tok.startsWith('`')) {
			push(tok.slice(1, -1), { font: 'Consolas', size: 18, shading: { type: ShadingType.CLEAR, fill: CINZA_CODIGO } });
		} else if (tok.startsWith('**')) {
			push(tok.slice(2, -2), { bold: true });
		} else if (tok.startsWith('[')) {
			const mm = tok.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
			runs.push(new ExternalHyperlink({
				link: mm[2].replace(/^<|>$/g, ''),
				children: [new TextRun({ text: mm[1], style: 'Hyperlink', ...base })]
			}));
		} else {
			push(tok.slice(1, -1), { italics: true });
		}
		pos = m.index + tok.length;
	}
	push(texto.slice(pos));
	return runs.length ? runs : [new TextRun({ text: '', ...base })];
}

// ---------- tabela ----------
function celulasDe(linha) {
	return linha.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
}

function montarTabela(linhasTab) {
	const header = celulasDe(linhasTab[0]);
	const corpoLinhas = linhasTab.slice(2).map(celulasDe);
	const nCols = header.length;
	// larguras proporcionais ao maior conteúdo de cada coluna (com piso e teto)
	const pesos = header.map((h, c) => {
		let max = h.length;
		for (const l of corpoLinhas) max = Math.max(max, (l[c] || '').length);
		return Math.min(Math.max(max, 8), 60);
	});
	const soma = pesos.reduce((a, b) => a + b, 0);
	let larguras = pesos.map((p) => Math.max(900, Math.round((p / soma) * CONTENT_WIDTH)));
	const dif = CONTENT_WIDTH - larguras.reduce((a, b) => a + b, 0);
	larguras[larguras.length - 1] += dif;

	const borda = { style: BorderStyle.SINGLE, size: 2, color: 'BFBFBF' };
	const bordas = { top: borda, bottom: borda, left: borda, right: borda };

	const linhaDoc = (cels, ehHeader, idx) =>
		new TableRow({
			tableHeader: ehHeader,
			children: cels.slice(0, nCols).concat(Array(Math.max(0, nCols - cels.length)).fill('')).map(
				(txt, c) =>
					new TableCell({
						width: { size: larguras[c], type: WidthType.DXA },
						borders: bordas,
						shading: {
							type: ShadingType.CLEAR,
							fill: ehHeader ? CINZA_CABEC : idx % 2 ? 'F7F9FC' : 'FFFFFF'
						},
						margins: { top: 60, bottom: 60, left: 90, right: 90 },
						children: [
							new Paragraph({
								spacing: { before: 20, after: 20 },
								children: inline(txt, ehHeader ? { bold: true, size: 18 } : { size: 18 })
							})
						]
					})
			)
		});

	return new Table({
		columnWidths: larguras,
		width: { size: CONTENT_WIDTH, type: WidthType.DXA },
		rows: [linhaDoc(header, true, 0)].concat(corpoLinhas.map((l, k) => linhaDoc(l, false, k + 1)))
	});
}

// ---------- corpo ----------
const filhos = [];
const L = corpo.split('\n');
let k = 0;
let primeiroH1 = true;

function paragrafo(texto, opts = {}) {
	return new Paragraph({ children: inline(texto), spacing: { after: 120, line: 276 }, ...opts });
}

while (k < L.length) {
	const linha = L[k];

	// bloco de código
	if (/^```/.test(linha.trim())) {
		k++;
		const buf = [];
		while (k < L.length && !/^```/.test(L[k].trim())) buf.push(L[k++].replace(/	/g, '  '));
		k++;
		buf.forEach((ln, idx) =>
			filhos.push(
				new Paragraph({
					shading: { type: ShadingType.CLEAR, fill: CINZA_CODIGO },
					spacing: { before: idx === 0 ? 100 : 0, after: idx === buf.length - 1 ? 140 : 0, line: 240 },
					keepLines: true,
					children: [new TextRun({ text: ln || ' ', font: 'Consolas', size: 17 })]
				})
			)
		);
		continue;
	}

	// tabela
	if (/^\|/.test(linha.trim()) && k + 1 < L.length && /^\|[\s:-]+\|/.test(L[k + 1].trim())) {
		const buf = [];
		while (k < L.length && /^\|/.test(L[k].trim())) buf.push(L[k++]);
		filhos.push(montarTabela(buf));
		filhos.push(new Paragraph({ spacing: { after: 160 }, children: [new TextRun('')] }));
		continue;
	}

	// títulos
	let m;
	if ((m = linha.match(/^#\s+(.*)$/))) {
		filhos.push(
			new Paragraph({
				heading: HeadingLevel.HEADING_1,
				pageBreakBefore: !primeiroH1 || true,
				spacing: { before: 240, after: 200 },
				children: inline(m[1])
			})
		);
		primeiroH1 = false;
		k++;
		continue;
	}
	if ((m = linha.match(/^##\s+(.*)$/))) {
		filhos.push(new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 320, after: 160 }, children: inline(m[1]) }));
		k++;
		continue;
	}
	if ((m = linha.match(/^###\s+(.*)$/))) {
		filhos.push(new Paragraph({ heading: HeadingLevel.HEADING_3, spacing: { before: 260, after: 120 }, children: inline(m[1]) }));
		k++;
		continue;
	}
	if ((m = linha.match(/^####\s+(.*)$/))) {
		filhos.push(new Paragraph({ heading: HeadingLevel.HEADING_4, spacing: { before: 200, after: 100 }, children: inline(m[1]) }));
		k++;
		continue;
	}

	// régua
	if (/^---+$/.test(linha.trim())) {
		filhos.push(
			new Paragraph({
				spacing: { before: 120, after: 160 },
				border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'BFBFBF', space: 1 } },
				children: [new TextRun('')]
			})
		);
		k++;
		continue;
	}

	// citação
	if ((m = linha.match(/^>\s?(.*)$/))) {
		const buf = [m[1]];
		k++;
		while (k < L.length && /^>\s?/.test(L[k])) buf.push(L[k++].replace(/^>\s?/, ''));
		filhos.push(
			new Paragraph({
				indent: { left: 360 },
				spacing: { before: 120, after: 160, line: 276 },
				border: { left: { style: BorderStyle.SINGLE, size: 12, color: AZUL, space: 8 } },
				shading: { type: ShadingType.CLEAR, fill: 'F4F6FB' },
				children: inline(buf.join(' ').trim(), { italics: false })
			})
		);
		continue;
	}

	// lista com marcador
	if (/^[-*]\s+/.test(linha)) {
		while (k < L.length && /^[-*]\s+/.test(L[k])) {
			filhos.push(
				new Paragraph({
					numbering: { reference: 'marcadores', level: 0 },
					spacing: { after: 80, line: 276 },
					children: inline(L[k].replace(/^[-*]\s+/, ''))
				})
			);
			k++;
		}
		continue;
	}

	// lista numerada
	if (/^\d+\.\s+/.test(linha)) {
		while (k < L.length && /^\d+\.\s+/.test(L[k])) {
			filhos.push(
				new Paragraph({
					numbering: { reference: 'numeros', level: 0 },
					spacing: { after: 80, line: 276 },
					children: inline(L[k].replace(/^\d+\.\s+/, ''))
				})
			);
			k++;
		}
		continue;
	}

	// caixa de seleção
	if (/^- \[ \]/.test(linha)) {
		filhos.push(paragrafo('☐ ' + linha.replace(/^- \[ \]\s*/, '')));
		k++;
		continue;
	}

	if (linha.trim() === '') {
		k++;
		continue;
	}

	filhos.push(paragrafo(linha.trim()));
	k++;
}

// ---------- capa + sumário ----------
const capa = [
	new Paragraph({ spacing: { before: 2600, after: 0 }, alignment: AlignmentType.CENTER,
		children: [new TextRun({ text: meta.SUBTITULO || '', size: 26, color: '404040', font: 'Calibri' })] }),
	new Paragraph({ spacing: { before: 240, after: 120 }, alignment: AlignmentType.CENTER,
		children: [new TextRun({ text: meta.TITULO || 'Documento', bold: true, size: 64, color: AZUL, font: 'Calibri' })] }),
	new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 400 },
		border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: AZUL, space: 12 } }, children: [new TextRun('')] }),
	new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 },
		children: [new TextRun({ text: meta.LINHA || '', size: 24, color: '404040' })] }),
	new Paragraph({ alignment: AlignmentType.CENTER,
		children: [new TextRun({ text: meta.DATA || '', size: 22, color: '767171' })] }),
	new Paragraph({ children: [new PageBreak()] }),
	new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { after: 200 }, children: [new TextRun('Sumário')] }),
	new TableOfContents('Sumário', { hyperlink: true, headingStyleRange: '1-3' })
];

const doc = new Document({
	creator: 'Projeto Escalas — PCCE',
	title: meta.TITULO || 'Apostila',
	description: meta.LINHA || '',
	features: { updateFields: true },
	numbering: {
		config: [
			{ reference: 'marcadores', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT,
				style: { paragraph: { indent: { left: 460, hanging: 260 } } } }] },
			{ reference: 'numeros', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT,
				style: { paragraph: { indent: { left: 460, hanging: 260 } } } }] }
		]
	},
	styles: {
		default: {
			document: { run: { font: 'Calibri', size: 21, color: '1A1A1A' }, paragraph: { spacing: { line: 276 } } },
			heading1: { run: { font: 'Calibri', size: 40, bold: true, color: AZUL } },
			heading2: { run: { font: 'Calibri', size: 30, bold: true, color: AZUL } },
			heading3: { run: { font: 'Calibri', size: 25, bold: true, color: '2E5496' } },
			heading4: { run: { font: 'Calibri', size: 22, bold: true, color: '404040' } }
		}
	},
	sections: [
		{
			properties: { page: { margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } },
			headers: {
				default: new Header({
					children: [new Paragraph({ alignment: AlignmentType.RIGHT,
						children: [new TextRun({ text: (meta.SUBTITULO || '') + ' — ' + (meta.TITULO || ''), size: 16, color: '808080' })] })]
				})
			},
			footers: {
				default: new Footer({
					children: [new Paragraph({ alignment: AlignmentType.CENTER,
						children: [new TextRun({ children: [PageNumber.CURRENT], size: 18, color: '808080' })] })]
				})
			},
			children: capa.concat(filhos)
		}
	]
});

Packer.toBuffer(doc).then((buf) => {
	fs.writeFileSync(OUT, buf);
	console.log('gerado:', OUT, (buf.length / 1024).toFixed(0) + ' KB', '| blocos:', filhos.length);
});
