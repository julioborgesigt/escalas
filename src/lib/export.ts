import {
	Document, Packer, Paragraph, Table, TableRow, TableCell,
	TextRun, WidthType, AlignmentType, BorderStyle, PageOrientation
} from 'docx';
import ExcelJS from 'exceljs';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

// Type augmentation for jspdf-autotable's lastAutoTable property
interface JsPDFWithAutoTable extends jsPDF {
	lastAutoTable?: { finalY: number };
}
import * as QRCode from 'qrcode';
import { PDFDocument } from 'pdf-lib';
import type { Escala, EscalaPolicialComDados } from './types';
import { formatarData, proximoDia, formatarDataExtenso } from './utils';

interface DiaPlantao {
	data: string;
	policiais: EscalaPolicialComDados[];
}

function getHoraEntrada(p: EscalaPolicialComDados, escala: Escala): string {
	return p.hora_entrada || escala.hora_entrada || '08';
}

function getHoraSaida(p: EscalaPolicialComDados, escala: Escala): string {
	return p.hora_saida || escala.hora_saida || '08';
}

function getDataSaida(p: EscalaPolicialComDados, escala: Escala): string {
	if (p.data_saida) return p.data_saida;
	const he = Number(getHoraEntrada(p, escala).split(':')[0]);
	const hs = Number(getHoraSaida(p, escala).split(':')[0]);
	if (hs <= he) return proximoDia(p.data_plantao);
	return p.data_plantao;
}

function formatarHorario(p: EscalaPolicialComDados, escala: Escala): string {
	const entrada = getHoraEntrada(p, escala);
	const saida = getHoraSaida(p, escala);
	return `${entrada}H A ${saida}H`;
}

function formatarDataPlantao(p: EscalaPolicialComDados, escala: Escala): string {
	const dataEntrada = formatarData(p.data_plantao);
	const dataSaida = getDataSaida(p, escala);
	if (dataSaida !== p.data_plantao) {
		return `${dataEntrada} à ${formatarData(dataSaida)}`;
	}
	return dataEntrada;
}

function agruparPorData(policiais: EscalaPolicialComDados[]): DiaPlantao[] {
	const map = new Map<string, EscalaPolicialComDados[]>();
	for (const p of policiais) {
		const list = map.get(p.data_plantao) || [];
		list.push(p);
		map.set(p.data_plantao, list);
	}
	return Array.from(map.entries())
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([data, policiais]) => ({ data, policiais }));
}

function formatarMatricula(matricula: string): string {
	return matricula;
}

// ---- DOCX ----
export async function gerarDocx(escala: Escala, policiais: EscalaPolicialComDados[]): Promise<Uint8Array> {
	const dias = agruparPorData(policiais);

	const titulo = new Paragraph({
		children: [new TextRun({
			text: `ESCALA PLANTÃO FINAL DE SEMANA ${escala.lotacao.toUpperCase()} ${formatarData(escala.data_inicio)} E ${formatarData(escala.data_fim)}`,
			bold: true,
			size: 24,
			font: 'Arial'
		})],
		alignment: AlignmentType.CENTER,
		spacing: { after: 300 }
	});

	const tables: (Table | Paragraph)[] = [];

	for (const dia of dias) {
		const headerRow = new TableRow({
			children: ['EQUIPE DE PLANTÃO DA DP', 'MATRÍCULA', 'CARGO', 'TELEFONE', 'LOTAÇÃO', 'DATA', 'HORÁRIO'].map(text =>
				new TableCell({
					children: [new Paragraph({
						children: [new TextRun({ text, bold: true, size: 16, font: 'Arial', color: 'FFFFFF' })],
						alignment: AlignmentType.CENTER
					})],
					shading: { fill: '1a5c57' },
					width: text === 'EQUIPE DE PLANTÃO DA DP' ? { size: 25, type: WidthType.PERCENTAGE } :
						text === 'LOTAÇÃO' ? { size: 20, type: WidthType.PERCENTAGE } :
							text === 'DATA' ? { size: 15, type: WidthType.PERCENTAGE } :
								{ size: 10, type: WidthType.PERCENTAGE }
				})
			)
		});

		const dataRows = dia.policiais.map(p =>
			new TableRow({
				children: [
					p.nome,
					formatarMatricula(p.matricula),
					p.cargo,
					p.telefone || '',
					p.lotacao,
					formatarDataPlantao(p, escala),
					formatarHorario(p, escala)
				].map((text, i) =>
					new TableCell({
						children: [new Paragraph({
							children: [new TextRun({ text, size: 18, font: 'Arial' })],
							alignment: i >= 5 ? AlignmentType.CENTER : AlignmentType.LEFT
						})],
						borders: {
							top: { style: BorderStyle.SINGLE, size: 1 },
							bottom: { style: BorderStyle.SINGLE, size: 1 },
							left: { style: BorderStyle.SINGLE, size: 1 },
							right: { style: BorderStyle.SINGLE, size: 1 }
						}
					})
				)
			})
		);

		tables.push(new Table({
			rows: [headerRow, ...dataRows],
			width: { size: 100, type: WidthType.PERCENTAGE }
		}));
		tables.push(new Paragraph({ spacing: { after: 200 } }));
	}

	const doc = new Document({
		sections: [{
			properties: {
				page: {
					size: {
						width: 16838,
						height: 11906,
						orientation: PageOrientation.LANDSCAPE
					},
					margin: { top: 720, bottom: 720, left: 720, right: 720 }
				}
			},
			children: [titulo, ...tables]
		}]
	});

	const blob = await Packer.toBlob(doc);
	return new Uint8Array(await blob.arrayBuffer());
}

// ---- XLSX ----
export async function gerarXlsx(escala: Escala, policiais: EscalaPolicialComDados[]): Promise<Uint8Array> {
	const dias = agruparPorData(policiais);
	const wb = new ExcelJS.Workbook();
	const ws = wb.addWorksheet('Escala');
	ws.columns = [
		{ width: 35 }, { width: 15 }, { width: 8 }, { width: 18 }, { width: 35 }, { width: 22 }, { width: 12 }
	];
	ws.addRow([`ESCALA PLANTÃO FINAL DE SEMANA ${escala.lotacao.toUpperCase()} ${formatarData(escala.data_inicio)} E ${formatarData(escala.data_fim)}`]);
	ws.addRow([]);

	for (const dia of dias) {
		ws.addRow(['EQUIPE DE PLANTÃO DA DP', 'MATRÍCULA', 'CARGO', 'TELEFONE', 'LOTAÇÃO', 'DATA', 'HORÁRIO']);
		for (const p of dia.policiais) {
			ws.addRow([
				p.nome,
				formatarMatricula(p.matricula),
				p.cargo,
				p.telefone || '',
				p.lotacao,
				formatarDataPlantao(p, escala),
				formatarHorario(p, escala)
			]);
		}
		ws.addRow([]);
	}
	const out = await wb.xlsx.writeBuffer();
	return new Uint8Array(out as ArrayBuffer);
}

export interface PdfExportResult {
	pdf: Uint8Array;
	finalY: number;
}

// ---- PDF ----
export function gerarPdf(escala: Escala, policiais: EscalaPolicialComDados[]): PdfExportResult {

	const dias = agruparPorData(policiais);
	const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

	doc.setFontSize(14);
	doc.text(
		`ESCALA PLANTÃO FINAL DE SEMANA ${escala.lotacao.toUpperCase()} ${formatarData(escala.data_inicio)} E ${formatarData(escala.data_fim)}`,
		148, 15, { align: 'center' }
	);

	let y = 25;

	for (const dia of dias) {
		const tableData = dia.policiais.map(p => [
			p.nome,
			formatarMatricula(p.matricula),
			p.cargo,
			p.telefone || '',
			p.lotacao,
			formatarDataPlantao(p, escala),
			formatarHorario(p, escala)
		]);

		autoTable(doc, {
			head: [['EQUIPE DE PLANTÃO DA DP', 'MATRÍCULA', 'CARGO', 'TELEFONE', 'LOTAÇÃO', 'DATA', 'HORÁRIO']],
			body: tableData,
			startY: y,
			theme: 'grid',
			headStyles: {
				fillColor: [26, 92, 87],
				textColor: 255,
				fontSize: 8,
				fontStyle: 'bold',
				halign: 'center'
			},
			bodyStyles: { fontSize: 8 },
			columnStyles: {
				0: { cellWidth: 50 },
				5: { halign: 'center', cellWidth: 35 },
				6: { halign: 'center' }
			},
			margin: { left: 10, right: 10 }
		});

		y = ((doc as JsPDFWithAutoTable).lastAutoTable?.finalY ?? y) + 10;
	}

	const lastY = (doc as JsPDFWithAutoTable).lastAutoTable?.finalY ?? y;
	const pageWidth = 297;
	// Footer e assinatura logo após a tabela - aumentado para evitar sobreposição do carimbo
	let sigY = lastY + 35;
	if (sigY > 185) {
		doc.addPage();
		sigY = 35;
	}

	const margin = 10;
	doc.setFontSize(9);
	doc.setFont('helvetica', 'normal');

	const localizacao = (escala.cidade && escala.cidade !== escala.lotacao) ? escala.cidade : '';
	const dataExtenso = formatarDataExtenso(new Date());
	const textoData = localizacao ? `${localizacao}, ${dataExtenso}` : dataExtenso;
	doc.text(textoData, margin, sigY);

	// Assinatura alinhada à direita
	const sigCenterX = pageWidth * 0.75;
	doc.line(sigCenterX - 45, sigY, sigCenterX + 45, sigY);
	doc.setFontSize(8);
	doc.text('Delegado(a) de Polícia / assinado digitalmente', sigCenterX, sigY + 5, { align: 'center' });

	return { pdf: new Uint8Array(doc.output('arraybuffer')), finalY: sigY };

}



// ---- Shared helper for expediente exports ----
function sortExpediente(policiais: EscalaPolicialComDados[]): EscalaPolicialComDados[] {
	return [...policiais].sort((a, b) => {
		if (a.cargo !== b.cargo) return a.cargo === 'DPC' ? -1 : 1;
		return a.nome.localeCompare(b.nome);
	});
}

const COLS_EXPEDIENTE = ['NOME COMPLETO', 'MATRÍCULA', 'CARGO', 'TELEFONE', 'CLASSE', 'LOTAÇÃO', 'REGIME', 'OBSERVAÇÕES'] as const;

function rowExpediente(p: EscalaPolicialComDados): string[] {
	return [p.nome, p.matricula, p.cargo, p.telefone || '', p.classe || '', p.lotacao, p.regime || '', p.observacoes || ''];
}

// ---- DOCX Expediente ----
export async function gerarDocxExpediente(escala: Escala, policiais: EscalaPolicialComDados[]): Promise<Uint8Array> {
	const sorted = sortExpediente(policiais);

	const titulo = new Paragraph({
		children: [new TextRun({ text: escala.titulo.toUpperCase(), bold: true, size: 24, font: 'Arial' })],
		alignment: AlignmentType.CENTER,
		spacing: { after: 150 }
	});

	const periodo = new Paragraph({
		children: [new TextRun({ text: `Período: ${formatarData(escala.data_inicio)} a ${formatarData(escala.data_fim)}`, size: 20, font: 'Arial' })],
		alignment: AlignmentType.CENTER,
		spacing: { after: 300 }
	});

	const borderStyle = { style: BorderStyle.SINGLE, size: 1 };
	const borders = { top: borderStyle, bottom: borderStyle, left: borderStyle, right: borderStyle };

	const headerRow = new TableRow({
		children: COLS_EXPEDIENTE.map(text =>
			new TableCell({
				children: [new Paragraph({ children: [new TextRun({ text, bold: true, size: 16, font: 'Arial', color: 'FFFFFF' })], alignment: AlignmentType.CENTER })],
				shading: { fill: '1a5c57' },
				borders
			})
		)
	});

	const dataRows = sorted.map(p =>
		new TableRow({
			children: rowExpediente(p).map((text, i) =>
				new TableCell({
					children: [new Paragraph({ children: [new TextRun({ text, size: 18, font: 'Arial' })], alignment: i >= 1 && i <= 4 ? AlignmentType.CENTER : AlignmentType.LEFT })],
					borders
				})
			)
		})
	);

	const doc = new Document({
		sections: [{
			properties: {
				page: {
					size: {
						width: 16838,
						height: 11906,
						orientation: PageOrientation.LANDSCAPE
					},
					margin: { top: 720, bottom: 720, left: 720, right: 720 }
				}
			},
			children: [titulo, periodo, new Table({ rows: [headerRow, ...dataRows], width: { size: 100, type: WidthType.PERCENTAGE } })]
		}]
	});

	const blob = await Packer.toBlob(doc);
	return new Uint8Array(await blob.arrayBuffer());
}

// ---- XLSX Expediente ----
export async function gerarXlsxExpediente(escala: Escala, policiais: EscalaPolicialComDados[]): Promise<Uint8Array> {
	const sorted = sortExpediente(policiais);
	const wb = new ExcelJS.Workbook();
	const ws = wb.addWorksheet('Escala');
	ws.columns = [{ width: 40 }, { width: 15 }, { width: 8 }, { width: 18 }, { width: 15 }, { width: 35 }, { width: 12 }, { width: 35 }];
	ws.addRow([escala.titulo.toUpperCase()]);
	ws.addRow([`Período: ${formatarData(escala.data_inicio)} a ${formatarData(escala.data_fim)}`]);
	ws.addRow([]);
	ws.addRow([...COLS_EXPEDIENTE]);
	for (const p of sorted) ws.addRow(rowExpediente(p));
	const out = await wb.xlsx.writeBuffer();
	return new Uint8Array(out as ArrayBuffer);
}

// ---- PDF Expediente ----
export function gerarPdfExpediente(escala: Escala, policiais: EscalaPolicialComDados[]): PdfExportResult {

	const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
	const pageWidth = 297;
	const margin = 10;

	const sorted = sortExpediente(policiais);

	// Header
	let y = 14;
	doc.setFontSize(10);
	doc.setFont('helvetica', 'bold');
	doc.text('POLÍCIA CIVIL DO ESTADO', pageWidth / 2, y, { align: 'center' });
	y += 6;
	doc.setFontSize(9);
	doc.text(escala.cidade.toUpperCase(), pageWidth / 2, y, { align: 'center' });
	y += 6;
	doc.setFontSize(11);
	doc.text(escala.titulo.toUpperCase(), pageWidth / 2, y, { align: 'center' });
	y += 6;
	doc.setFontSize(9);
	doc.setFont('helvetica', 'normal');
	doc.text(`Período: ${formatarData(escala.data_inicio)} a ${formatarData(escala.data_fim)}`, pageWidth / 2, y, { align: 'center' });
	y += 8;

	autoTable(doc, {
		head: [[...COLS_EXPEDIENTE]],
		body: sorted.map(p => rowExpediente(p)),
		startY: y,
		theme: 'grid',
		headStyles: {
			fillColor: [26, 92, 87],
			textColor: 255,
			fontSize: 7,
			fontStyle: 'bold',
			halign: 'center'
		},
		bodyStyles: { fontSize: 7 },
		columnStyles: {
			0: { cellWidth: 55 },
			1: { cellWidth: 28, halign: 'center' },
			2: { cellWidth: 14, halign: 'center' },
			3: { cellWidth: 28, halign: 'center' },
			4: { cellWidth: 22, halign: 'center' },
			5: { cellWidth: 38 },
			6: { cellWidth: 22, halign: 'center' },
			7: { cellWidth: 'auto' }
		},
		margin: { left: margin, right: margin }
	});

	const lastY = (doc as JsPDFWithAutoTable).lastAutoTable?.finalY ?? y;
	// Footer e assinatura logo após a tabela - aumentado offset para evitar sobreposição
	let sigY = lastY + 45;
	if (sigY > 185) {
		doc.addPage();
		sigY = 35;
	}

	const marginLine = 10;
	doc.setFontSize(9);
	doc.setFont('helvetica', 'normal');

	const localizacao = (escala.cidade && escala.cidade !== escala.lotacao) ? escala.cidade : '';
	const dataExtenso = formatarDataExtenso(new Date());
	const textoData = localizacao ? `${localizacao}, ${dataExtenso}` : dataExtenso;
	doc.text(textoData, marginLine, sigY);

	// Assinatura alinhada à direita e na mesma altura da data
	const sigCenterX = pageWidth * 0.75;
	doc.line(sigCenterX - 45, sigY, sigCenterX + 45, sigY);
	doc.setFontSize(8);
	doc.text('Delegado(a) de Polícia / assinado digitalmente', sigCenterX, sigY + 5, { align: 'center' });

	return { pdf: new Uint8Array(doc.output('arraybuffer')), finalY: sigY };

}


// ---- Shared helpers for plantão exports ----

interface OficialPlantao {
	policial_id: number;
	equipe: string;
	nome: string;
	matricula: string;
	cargo: string;
	telefone: string;
	lotacao: string;
	dias: string[];
	observacoes: string;
}

function agruparPlantao(policiais: EscalaPolicialComDados[]): Map<string, OficialPlantao[]> {
	const oficiais = new Map<string, OficialPlantao>();
	for (const p of policiais) {
		const key = `${p.policial_id}_${p.equipe || ''}`;
		if (!oficiais.has(key)) {
			oficiais.set(key, {
				policial_id: p.policial_id,
				equipe: p.equipe || '',
				nome: p.nome,
				matricula: p.matricula,
				cargo: p.cargo,
				telefone: p.telefone || '',
				lotacao: p.lotacao,
				dias: [],
				observacoes: p.observacoes || ''
			});
		}
		oficiais.get(key)!.dias.push(p.data_plantao);
	}

	const equipes = new Map<string, OficialPlantao[]>();
	for (const oficial of oficiais.values()) {
		oficial.dias.sort();
		const list = equipes.get(oficial.equipe) || [];
		list.push(oficial);
		equipes.set(oficial.equipe, list);
	}

	for (const list of equipes.values()) {
		list.sort((a, b) => {
			if (a.cargo !== b.cargo) return a.cargo === 'DPC' ? -1 : 1;
			return a.nome.localeCompare(b.nome);
		});
	}

	return new Map([...equipes.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

function formatarDias(dias: string[]): string {
	return dias.map((d) => d.split('-')[2]).join(', ');
}

function formatarMesAno(dateStr: string): string {
	if (!dateStr) return '';
	const [year, month] = dateStr.split('-');
	const meses = ['JANEIRO', 'FEVEREIRO', 'MARÇO', 'ABRIL', 'MAIO', 'JUNHO', 'JULHO', 'AGOSTO', 'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO'];
	return `${meses[Number(month) - 1]}/${year}`;
}

const COLS_PLANTAO = ['NOME', 'MATRÍCULA', 'CARGO', 'TELEFONE', 'LOTAÇÃO', 'DIAS', 'OBSERVAÇÕES'] as const;

function rowPlantao(o: OficialPlantao): string[] {
	return [o.nome, o.matricula, o.cargo, o.telefone, o.lotacao, formatarDias(o.dias), o.observacoes];
}

// ---- DOCX Plantão ----
export async function gerarDocxPlantao(escala: Escala, policiais: EscalaPolicialComDados[]): Promise<Uint8Array> {
	const equipes = agruparPlantao(policiais);

	const titulo = new Paragraph({
		children: [new TextRun({ text: 'POLÍCIA CIVIL DO ESTADO DO CEARÁ', bold: true, size: 22, font: 'Arial' })],
		alignment: AlignmentType.CENTER,
		spacing: { after: 100 }
	});

	const subtitulo = new Paragraph({
		children: [new TextRun({ text: `DELEGACIA: ${escala.cidade.toUpperCase()} — MÊS/ANO: ${formatarMesAno(escala.data_inicio)}`, bold: true, size: 20, font: 'Arial' })],
		alignment: AlignmentType.CENTER,
		spacing: { after: 300 }
	});

	const borderStyle = { style: BorderStyle.SINGLE, size: 1 };
	const borders = { top: borderStyle, bottom: borderStyle, left: borderStyle, right: borderStyle };

	const children: (Table | Paragraph)[] = [titulo, subtitulo];

	for (const [equipe, oficiais] of equipes) {
		const equipeLabel = equipe ? `EQUIPE ${equipe}` : 'EQUIPE';
		children.push(new Paragraph({
			children: [new TextRun({ text: equipeLabel, bold: true, size: 20, font: 'Arial', color: '1a5c57' })],
			spacing: { before: 200, after: 100 }
		}));

		const headerRow = new TableRow({
			children: COLS_PLANTAO.map((text) =>
				new TableCell({
					children: [new Paragraph({ children: [new TextRun({ text, bold: true, size: 16, font: 'Arial', color: 'FFFFFF' })], alignment: AlignmentType.CENTER })],
					shading: { fill: '1a5c57' },
					borders
				})
			)
		});

		const dataRows = oficiais.map((o) =>
			new TableRow({
				children: rowPlantao(o).map((text, i) =>
					new TableCell({
						children: [new Paragraph({ children: [new TextRun({ text, size: 18, font: 'Arial' })], alignment: i >= 1 && i <= 3 ? AlignmentType.CENTER : AlignmentType.LEFT })],
						borders
					})
				)
			})
		);

		children.push(new Table({ rows: [headerRow, ...dataRows], width: { size: 100, type: WidthType.PERCENTAGE } }));
		children.push(new Paragraph({ spacing: { after: 100 } }));
	}

	const doc = new Document({
		sections: [{
			properties: {
				page: {
					size: {
						width: 16838,
						height: 11906,
						orientation: PageOrientation.LANDSCAPE
					},
					margin: { top: 720, bottom: 720, left: 720, right: 720 }
				}
			},
			children
		}]
	});

	const blob = await Packer.toBlob(doc);
	return new Uint8Array(await blob.arrayBuffer());
}

// ---- XLSX Plantão ----
export async function gerarXlsxPlantao(escala: Escala, policiais: EscalaPolicialComDados[]): Promise<Uint8Array> {
	const equipes = agruparPlantao(policiais);
	const wb = new ExcelJS.Workbook();
	const ws = wb.addWorksheet('Escala');
	ws.columns = [{ width: 40 }, { width: 15 }, { width: 8 }, { width: 18 }, { width: 35 }, { width: 35 }, { width: 30 }];
	ws.addRow(['POLÍCIA CIVIL DO ESTADO DO CEARÁ']);
	ws.addRow([`DELEGACIA: ${escala.cidade.toUpperCase()} — MÊS/ANO: ${formatarMesAno(escala.data_inicio)}`]);
	ws.addRow([]);

	for (const [equipe, oficiais] of equipes) {
		ws.addRow([equipe ? `EQUIPE ${equipe}` : 'EQUIPE']);
		ws.addRow([...COLS_PLANTAO]);
		for (const o of oficiais) ws.addRow(rowPlantao(o));
		ws.addRow([]);
	}
	const out = await wb.xlsx.writeBuffer();
	return new Uint8Array(out as ArrayBuffer);
}

// ---- PDF Plantão ----
export function gerarPdfPlantao(escala: Escala, policiais: EscalaPolicialComDados[]): PdfExportResult {

	const equipes = agruparPlantao(policiais);
	const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
	const pageWidth = 297;
	const margin = 10;

	let y = 12;
	doc.setFontSize(10);
	doc.setFont('helvetica', 'bold');
	doc.text('POLÍCIA CIVIL DO ESTADO DO CEARÁ', pageWidth / 2, y, { align: 'center' });
	y += 5;
	doc.setFontSize(8);
	doc.setFont('helvetica', 'normal');
	doc.text('DELEGACIA GERAL DA POLÍCIA CIVIL / DEPARTAMENTO DE POLÍCIA JUDICIÁRIA DO INTERIOR SUL', pageWidth / 2, y, { align: 'center' });
	y += 5;
	doc.setFont('helvetica', 'bold');
	doc.text(`DELEGACIA: ${escala.lotacao.toUpperCase()}`, margin, y);
	y += 5;
	doc.text(`MÊS/ANO: ${formatarMesAno(escala.data_inicio)}`, margin, y);
	y += 8;


	for (const [equipe, oficiais] of equipes) {
		const equipeLabel = equipe ? `EQUIPE ${equipe}` : 'EQUIPE';
		const rows = oficiais.map((o) => rowPlantao(o));

		autoTable(doc, {
			head: [
				[{ content: equipeLabel, colSpan: 7, styles: { halign: 'center', fillColor: [26, 92, 87], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 } }],
				[...COLS_PLANTAO]
			],
			body: rows,
			startY: y,
			theme: 'grid',
			headStyles: { fillColor: [26, 92, 87], textColor: 255, fontSize: 7, fontStyle: 'bold', halign: 'center' },
			bodyStyles: { fontSize: 7 },
			columnStyles: {
				0: { cellWidth: 55 },
				1: { cellWidth: 28, halign: 'center' },
				2: { cellWidth: 14, halign: 'center' },
				3: { cellWidth: 28, halign: 'center' },
				4: { cellWidth: 38 },
				5: { cellWidth: 55, halign: 'center' },
				6: { cellWidth: 'auto' }
			},
			margin: { left: margin, right: margin }
		});

		y = ((doc as JsPDFWithAutoTable).lastAutoTable?.finalY ?? y) + 6;
	}

	const lastY = (doc as JsPDFWithAutoTable).lastAutoTable?.finalY ?? y;

	// Footer e assinatura logo após a tabela - aumentado offset para evitar sobreposição
	let sigY = lastY + 45;
	if (sigY > 190) {
		doc.addPage();
		sigY = 35;
	}

	doc.setFontSize(8);
	doc.setFont('helvetica', 'normal');
	doc.text('Obs.: Escala sujeita a alteração conforme necessidade do serviço.', margin, sigY - 10);

	// Data alinhada na mesma altura da linha de assinatura
	doc.setFontSize(9);
	const localizacao = (escala.cidade && escala.cidade !== escala.lotacao) ? escala.cidade : '';
	const dataExtenso = formatarDataExtenso(new Date());
	const textoData = localizacao ? `${localizacao}, ${dataExtenso}` : dataExtenso;
	doc.text(textoData, margin, sigY);

	// Assinatura já alinhada à direita, agora na mesma altura da data
	const sigCenterX = pageWidth * 0.75;
	doc.line(sigCenterX - 45, sigY, sigCenterX + 45, sigY);
	doc.setFontSize(8);
	doc.text('Delegado(a) de Polícia / assinado digitalmente', sigCenterX, sigY + 5, { align: 'center' });

	return { pdf: new Uint8Array(doc.output('arraybuffer')), finalY: sigY };

}

// ---- GISE PDF ----

export interface GisePdfData {
	data_inicio: string;
	hora_entrada: string;
	hora_saida: string;
	status: string;
	supervisor_nome: string | null;
	supervisor_matricula: string | null;
	supervisor_telefone: string | null;
	assessor_nome: string | null;
	assessor_matricula: string | null;
	assessor_telefone: string | null;
	seint1_nome: string | null;
	seint1_matricula: string | null;
	seint1_telefone: string | null;
	seint2_nome: string | null;
	seint2_matricula: string | null;
	seint2_telefone: string | null;
	seccionais: Array<{
		seccional_id: number;
		seccional_nome: string;
		unidade_operacional_nome: string | null;
		status: string;
		hora_entrada: string | null;
		hora_saida: string | null;
		equipes: Array<{
			tipo: string;
			slots_dpc: number;
			slots_oip: number;
			hora_entrada: string | null;
			hora_saida: string | null;
			membros: Array<{
				policial_id: number;
				policial_nome: string;
				policial_cargo: string;
				policial_matricula: string;
				policial_telefone: string | null;
				policial_lotacao: string | null;
				policial_classe?: string | null;
				presenca?: { entrada_timestamp?: string | null; saida_timestamp?: string | null; entrada_rubrica?: string | null; saida_rubrica?: string | null } | null;
			}>;
		}>;
	}>;
	documento: { rubrica?: string | null; verificacao_hash?: string | null } | null;
}

function fmtHoraGise(h: any): string {
	if (!h) return '';
	if (String(h).includes(':')) return h;
	const n = parseInt(String(h));
	if (isNaN(n)) return String(h);
	return `${String(n).padStart(2, '0')}:00`;
}

/**
 * Transforma GiseDetalhado (estrutura do DB com unidades) em GisePdfData (estrutura plana com equipes).
 */
export function toGisePdfData(gise: import('$lib/db').GiseDetalhado): GisePdfData {
	if (!gise) throw new Error('Dados da GISE não fornecidos');

	return {
		data_inicio: gise.data_inicio || '',
		hora_entrada: gise.hora_entrada || '08:00',
		hora_saida: gise.hora_saida || '16:00',
		status: gise.status || '',
		supervisor_nome: gise.supervisor_nome,
		supervisor_matricula: gise.supervisor_matricula,
		supervisor_telefone: gise.supervisor_telefone,
		assessor_nome: gise.assessor_nome,
		assessor_matricula: gise.assessor_matricula,
		assessor_telefone: gise.assessor_telefone,
		seint1_nome: gise.seint1_nome,
		seint1_matricula: gise.seint1_matricula,
		seint1_telefone: gise.seint1_telefone,
		seint2_nome: gise.seint2_nome,
		seint2_matricula: gise.seint2_matricula,
		seint2_telefone: gise.seint2_telefone,
		seccionais: (gise.seccionais || []).map(sec => {
			const equipesList: GisePdfData['seccionais'][number]['equipes'] = [];

			(sec.unidades || []).forEach(slot => {
				(slot.equipes || []).forEach(eq => {
					equipesList.push({
						tipo: eq.tipo,
						slots_dpc: eq.slots_dpc || 0,
						slots_oip: eq.slots_oip || 0,
						hora_entrada: eq.hora_entrada,
						hora_saida: eq.hora_saida,
						membros: (eq.membros || []).map(m => ({
							policial_id: m.policial_id,
							policial_nome: m.policial_nome || '—',
							policial_cargo: m.policial_cargo || '',
							policial_matricula: m.policial_matricula || '',
							policial_telefone: m.policial_telefone,
							policial_lotacao: m.policial_lotacao,
							policial_classe: m.policial_classe,
							presenca: m.presenca
						}))
					});
				});
			});

			return {
				seccional_id: sec.seccional_id,
				seccional_nome: sec.seccional_nome || '—',
				unidade_operacional_nome: sec.unidades?.[0]?.nome ?? null,
				status: sec.status || '',
				hora_entrada: sec.hora_entrada,
				hora_saida: sec.hora_saida,
				equipes: equipesList
			};
		}),
		documento: gise.documento ? {
			rubrica: gise.documento.rubrica,
			verificacao_hash: gise.documento.verificacao_hash
		} : null
	};
}


export async function gerarPdfGise(gise: GisePdfData, logoJpgBytes?: Uint8Array): Promise<PdfExportResult> {
	const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
	const pageWidth = 297;

	doc.setFontSize(14);
	doc.setFont('helvetica', 'bold');
	doc.text(`Escala GISE SUL para o dia ${formatarData(gise.data_inicio)}`, pageWidth / 2, 14, { align: 'center' });

	let y = 26;

	for (const sec of gise.seccionais) {
		if (y > 175) { doc.addPage(); y = 15; }

		doc.setFontSize(11);
		doc.setFont('helvetica', 'bold');
		const secHora = sec.hora_entrada ? ` (H. ${sec.hora_entrada}-${sec.hora_saida})` : '';
		doc.text(`${sec.seccional_nome}${secHora}`, 10, y);
		y += 4;

		for (const equipe of sec.equipes) {
			if (y > 175) { doc.addPage(); y = 15; }

			const hEnt = equipe.hora_entrada || sec.hora_entrada || gise.hora_entrada;
			const hSai = equipe.hora_saida || sec.hora_saida || gise.hora_saida;

			const titleLabel = equipe.tipo === 'operacional'
				? `Equipe Operacional - ${sec.unidade_operacional_nome ?? '—'}`
				: `Equipe SEINT`;

			const tableData = equipe.membros.map(m => [
				m.policial_nome,
				m.policial_cargo,
				m.policial_matricula,
				m.policial_telefone || '—',
				m.policial_lotacao,
				formatarData(gise.data_inicio),
				fmtHoraGise(hEnt),
				formatarData(gise.data_inicio),
				fmtHoraGise(hSai)
			]);

			if (tableData.length === 0) {
				tableData.push(['(sem membros alocados)', '', '', '', '', '', '', '', '']);
			}

			autoTable(doc, {
				head: [[{ content: titleLabel, colSpan: 9, styles: { halign: 'center' } }],
				['Nome', 'Cargo', 'Matrícula', 'Telefone', 'Lotação', 'Data de Início', 'Hora de Início', 'Data de Término', 'Hora de Término']],
				body: tableData,
				startY: y,
				theme: 'grid',
				headStyles: {
					fillColor: equipe.tipo === 'operacional' ? [26, 92, 87] : [59, 59, 118],
					textColor: 255,
					fontSize: 7.5,
					fontStyle: 'bold',
					halign: 'center',
					lineColor: [255, 255, 255],
					lineWidth: 0.3
				},
				bodyStyles: { fontSize: 7.5, lineColor: [180, 180, 180], lineWidth: 0.3 },
				columnStyles: {
					0: { cellWidth: 55 },
					1: { halign: 'center', cellWidth: 15 },
					2: { halign: 'center', cellWidth: 25 },
					3: { halign: 'center', cellWidth: 25 },
					4: { cellWidth: 70 },
					5: { halign: 'center', cellWidth: 23 },
					6: { halign: 'center', cellWidth: 15 },
					7: { halign: 'center', cellWidth: 23 },
					8: { halign: 'center', cellWidth: 15 }
				},
				margin: { left: 10, right: 10 }
			});

			y = ((doc as JsPDFWithAutoTable).lastAutoTable?.finalY ?? y) + 6;
		}

		y += 4;
	}

	// Assinatura
	const lastY = (doc as JsPDFWithAutoTable).lastAutoTable?.finalY ?? y;
	let sigY = lastY + 40;
	if (sigY > 185) {
		doc.addPage();
		sigY = 35;
	}

	const sigCenterX = pageWidth * 0.75;
	const docData = gise.documento;

	if (docData?.rubrica) {
		try {
			const format = getImgFormat(docData.rubrica);
			doc.addImage(docData.rubrica, format || 'PNG', sigCenterX - 30, sigY - 25, 60, 22);
		} catch (e) {
			console.error('Erro ao inserir rubrica no PDF GISE:', e);
		}
	}

	// Bloco de Supervisão no canto inferior esquerdo
	doc.setFontSize(8);
	doc.setFont('helvetica', 'bold');
	let contactY = sigY - 12; 

	if (gise.supervisor_nome) {
		doc.text(`Supervisão e apoio: `, 10, contactY);
		const nameX = 10 + doc.getTextWidth('Supervisão e apoio: ');
		doc.setFont('helvetica', 'normal');
		doc.text(`${gise.supervisor_nome} - ${gise.supervisor_telefone || '—'}`, nameX, contactY);
		contactY += 4;
	}
	if (gise.assessor_nome) {
		doc.setFont('helvetica', 'bold');
		doc.text(`Assessor: `, 10, contactY);
		const nameX = 10 + doc.getTextWidth('Assessor: ');
		doc.setFont('helvetica', 'normal');
		doc.text(`${gise.assessor_nome} - ${gise.assessor_telefone || '—'}`, nameX, contactY);
		contactY += 4;
	}
	if (gise.seint1_nome) {
		doc.setFont('helvetica', 'bold');
		doc.text(`Inteligência: `, 10, contactY);
		const nameX = 10 + doc.getTextWidth('Inteligência: ');
		doc.setFont('helvetica', 'normal');
		doc.text(`${gise.seint1_nome} - ${gise.seint1_telefone || '—'}`, nameX, contactY);
		contactY += 4;
	}
	if (gise.seint2_nome) {
		doc.setFont('helvetica', 'bold');
		doc.text(`Inteligência: `, 10, contactY);
		const nameX = 10 + doc.getTextWidth('Inteligência: ');
		doc.setFont('helvetica', 'normal');
		doc.text(`${gise.seint2_nome} - ${gise.seint2_telefone || '—'}`, nameX, contactY);
		contactY += 4;
	}

	// Assinatura (alinhada à direita)
	doc.line(sigCenterX - 45, sigY, sigCenterX + 45, sigY);
	doc.setFontSize(8);
	doc.setFont('helvetica', 'bold');
	doc.text((gise.supervisor_nome || 'Supervisão do GISE').toUpperCase(), sigCenterX, sigY + 4, { align: 'center' });
	doc.setFont('helvetica', 'normal');
	doc.text(`Matrícula: ${gise.supervisor_matricula || '—'}`, sigCenterX, sigY + 8, { align: 'center' });
	doc.text('Delegado(a) de Polícia / assinado digitalmente', sigCenterX, sigY + 12, { align: 'center' });

	// Pós-processamento: inserir logo via pdf-lib usando bytes puros do JPEG (vindos do R2).
	// jsPDF.addImage falha silenciosamente no Cloudflare Workers por falta de DOM/Canvas.
	const pdfBytes = new Uint8Array(doc.output('arraybuffer'));

	if (!logoJpgBytes || logoJpgBytes.length === 0) {
		return { pdf: pdfBytes, finalY: sigY };
	}

	try {
		const pdfDoc = await PDFDocument.load(pdfBytes);
		const jpgImage = await pdfDoc.embedJpg(logoJpgBytes);
		const pages = pdfDoc.getPages();
		const mmToPt = 2.83465;

		for (const page of pages) {
			const { height } = page.getSize();
			page.drawImage(jpgImage, {
				x: 10 * mmToPt,
				y: height - (5 * mmToPt) - (14 * mmToPt),
				width: 45 * mmToPt,
				height: 14 * mmToPt
			});
		}

		const modifiedPdf = await pdfDoc.save();
		return { pdf: modifiedPdf, finalY: sigY };
	} catch (e: any) {
		console.error('Erro ao inserir logo com pdf-lib:', e.message || e);
		return { pdf: pdfBytes, finalY: sigY };
	}
}

export interface GiseProdutividadeData {
	gise: any;
	seccional: any;
	supervisorDoc?: any;
	baseUrl?: string;
	respostas?: any[];
}

export function gerarRelatorioProdutividadeGisePdf(data: GiseProdutividadeData) {
	const { gise, seccional, respostas = [] } = data;
	const doc = new jsPDF('p', 'mm', 'a4');
	const margin = 15;
	const pageWidth = doc.internal.pageSize.getWidth();
	let y = 20;

	doc.setFont('helvetica', 'bold');
	doc.setFontSize(14);
	doc.text('POLÍCIA CIVIL DO ESTADO DO CEARÁ', pageWidth / 2, y, { align: 'center' });
	y += 7;
	doc.setFontSize(12);
	doc.text('DEPARTAMENTO DE POLÍCIA DO INTERIOR SUL', pageWidth / 2, y, { align: 'center' });
	y += 10;

	doc.setFontSize(14);
	doc.text('RELATÓRIO DE PRODUTIVIDADE GISE', pageWidth / 2, y, { align: 'center' });
	y += 10;

	doc.setFontSize(10);
	doc.setFont('helvetica', 'normal');
	doc.text(`Data: ${formatarData(gise.data_inicio)}`, margin, y);
	y += 5;
	doc.text(`Seccional: ${seccional.seccional_nome || seccional.nome}`, margin, y);
	y += 10;

	if (respostas.length === 0) {
		doc.setFont('helvetica', 'italic');
		doc.text('Nenhum dado de produtividade preenchido para este período.', margin, y);
	} else {
		const teams = seccional.equipes || [];

		for (const team of teams) {
			const teamResponses = respostas.filter((r: any) => r.equipe_id === team.id);
			if (teamResponses.length === 0) continue;

			doc.setFont('helvetica', 'bold');
			doc.setFillColor(245, 245, 245);
			doc.rect(margin, y, pageWidth - 2 * margin, 8, 'F');
			doc.text(`EQUIPE: ${team.tipo === 'operacional' ? 'OPERACIONAL' : 'SEINT'}`, margin + 2, y + 6);
			y += 12;

			const rows = teamResponses.map((r: any) => [r.pergunta, r.resposta]);

			autoTable(doc, {
				startY: y,
				head: [['Pergunta', 'Resposta']],
				body: rows,
				margin: { left: margin, right: margin },
				theme: 'grid',
				styles: { fontSize: 9, cellPadding: 3 },
				headStyles: { fillColor: [60, 60, 60], textColor: 255 },
				columnStyles: {
					0: { cellWidth: 100 },
					1: { cellWidth: 'auto' }
				}
			});

			y = ((doc as JsPDFWithAutoTable).lastAutoTable?.finalY ?? y) + 15;

			if (y > doc.internal.pageSize.getHeight() - 30) {
				doc.addPage();
				y = 20;
			}
		}
	}

	const now = new Date();
	const dataExtenso = `${now.getDate()} de ${['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'][now.getMonth()]} de ${now.getFullYear()}`;
	doc.setFontSize(10);
	doc.setFont('helvetica', 'normal');
	doc.text(`Gerado em: ${dataExtenso}`, margin, doc.internal.pageSize.getHeight() - 10);

	return { pdf: new Uint8Array(doc.output('arraybuffer')), finalY: y };
}

export async function gerarRelatorioExtraordinarioPdf(gise: GisePdfData, presencas: any[], seccionalId?: number, baseUrl?: string, reportSignature?: any, qrCodeBase64?: string, isPreparando = false): Promise<PdfExportResult> {
	const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
	const pageWidth = 297;
	const margin = 10;

	let y = 14;
	doc.setFontSize(11);
	doc.setFont('helvetica', 'bold');
	doc.text('POLÍCIA CIVIL DO ESTADO DO CEARÁ', pageWidth / 2, y, { align: 'center' });
	y += 5;
	doc.text('DELEGACIA GERAL DE POLÍCIA CIVIL', pageWidth / 2, y, { align: 'center' });
	y += 5;
	doc.setFontSize(10);
	doc.text('DEPARTAMENTO DE POLÍCIA DO INTERIOR SUL - DPI SUL', pageWidth / 2, y, { align: 'center' });
	y += 5;
	const primeiraSec = gise.seccionais.find(s => s.seccional_id === seccionalId)?.seccional_nome || gise.seccionais[0]?.seccional_nome || '';
	doc.text(`${primeiraSec.toUpperCase()}`, pageWidth / 2, y, { align: 'center' });
	y += 10;

	doc.setFontSize(12);
	doc.text('RELATÓRIO DE SERVIÇO EXTRAORDINÁRIO', pageWidth / 2, y, { align: 'center' });
	y += 10;

	const hEnt = gise.hora_entrada;
	const hSai = gise.hora_saida;

	let dataSaidaEfetiva = gise.data_inicio;
	const heVal = parseInt(hEnt.split(':')[0]);
	const hsVal = parseInt(hSai.split(':')[0]);
	if (hsVal <= heVal) {
		const dObj = new Date(gise.data_inicio + 'T12:00:00');
		dObj.setDate(dObj.getDate() + 1);
		dataSaidaEfetiva = dObj.toISOString().split('T')[0];
	}

	let diff = hsVal - heVal;
	if (diff <= 0) diff += 24;

	doc.setFontSize(10);
	doc.setFont('helvetica', 'normal');
	const textoData = `DATA: das ${hEnt} de ${formatarData(gise.data_inicio)} às ${hSai} horas de ${formatarData(dataSaidaEfetiva)} (${diff} horas)`;
	doc.text(textoData, pageWidth / 2, y, { align: 'center' });
	y += 10;

	doc.text('BREVE RELATÓRIO:', margin, y);
	y += 5;
	doc.setFont('helvetica', 'bold');
	const boxY = y;
	doc.rect(margin, boxY, pageWidth - 20, 15);
	const relatorioTexto = 'EM RAZÃO DE SERVIÇO EXTRAORDINÁRIO (GISE) OS SERVIDORES ABAIXO RELACIONADOS RECEBERÃO GRATIFICAÇÃO NA FORMA DE DIÁRIAS DE REFORÇO OPERACIONAL.';
	const splitText = doc.splitTextToSize(relatorioTexto, pageWidth - 30);
	doc.text(splitText, margin + 5, boxY + 7);
	y += 25;

	const allMembros: Array<GisePdfData['seccionais'][number]['equipes'][number]['membros'][number] & { seccional: string; presencaData: typeof presencas[number] | undefined }> = [];
	for (const sec of gise.seccionais) {
		if (seccionalId && sec.seccional_id !== seccionalId) continue;
		for (const eq of sec.equipes) {
			for (const m of eq.membros) {
				const pres = presencas.find(p => p.policial_id === m.policial_id);
				allMembros.push({ ...m, seccional: sec.seccional_nome, presencaData: pres });
			}
		}
	}

	const tableData = allMembros.map(m => [
		m.policial_nome,
		m.policial_cargo,
		m.policial_matricula,
		m.policial_classe || '',
		m.policial_lotacao || m.seccional,
		`${formatarData(gise.data_inicio)}\n${m.presencaData?.entrada_timestamp ? new Date(m.presencaData.entrada_timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : ''}`,
		{ content: '', image: m.presencaData?.entrada_rubrica },
		`${formatarData(dataSaidaEfetiva)}\n${m.presencaData?.saida_timestamp ? new Date(m.presencaData.saida_timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : ''}`,
		{ content: '', image: m.presencaData?.saida_rubrica }
	]);

	autoTable(doc, {
		head: [['NOME COMPLETO', 'CARGO', 'MATRÍCULA', 'CLASSE', 'LOTAÇÃO', 'HORA DE INÍCIO', 'RUBRICA', 'HORA DE SAÍDA', 'RUBRICA']],
		body: tableData,
		startY: y,
		theme: 'grid',
		margin: { left: margin, right: margin },
		styles: { fontSize: 8, cellPadding: 2, halign: 'center', valign: 'middle', minCellHeight: 16 },
		headStyles: { fillColor: [200, 200, 200], textColor: 0, fontStyle: 'bold' },
		didDrawCell: (data) => {
			if ((data.column.index === 6 || data.column.index === 8) && data.cell.section === 'body') {
				const rawCell = data.cell.raw as { image?: string; content?: string } | string | null;
				const imgData = (typeof rawCell === 'object' && rawCell !== null) ? rawCell.image : rawCell;

				// Só tenta inserir se for uma string base64 com prefixo data:image/
				// Qualquer outro valor (URL, string sem prefixo, null) é ignorado
				// para evitar o quadrado preto gerado pelo jsPDF quando recebe dados inválidos
				const isValidBase64Image = typeof imgData === 'string' &&
					imgData.startsWith('data:image/') &&
					imgData.includes(';base64,') &&
					imgData.length > 200; // base64 real tem pelo menos 200 caracteres

				if (!isValidBase64Image) return;

				const targetW = data.cell.width - 4;
				const targetH = targetW / 2;
				const xPos = data.cell.x + 2;
				const yPos = data.cell.y + (data.cell.height - targetH) / 2;

				try {
					const format = getImgFormat(imgData);
					if (!format) {
						// Formato indeterminado — não renderizar para evitar quadro preto
						return;
					}
					doc.addImage(imgData, format, xPos, yPos, targetW, targetH, undefined, 'FAST');
				} catch (e) {
					// Em caso de erro, não renderizar nada (melhor que quadro preto)
					console.warn('[relatorio-extra] Erro ao inserir rúbrica na célula:', e);
				}
			}
		},
		columnStyles: {
			0: { halign: 'left', cellWidth: 70 },
			1: { cellWidth: 15 },
			2: { cellWidth: 25 },
			3: { cellWidth: 15 },
			4: { cellWidth: 42 },
			5: { cellWidth: 25 },
			6: { cellWidth: 30 },
			7: { cellWidth: 25 },
			8: { cellWidth: 30 }
		}
	});
	const lastAutoY = (doc as JsPDFWithAutoTable).lastAutoTable?.finalY ?? y;
	let sigY = lastAutoY + 40;
	if (sigY > 185) { doc.addPage(); sigY = 40; }

	doc.setFontSize(10);
	doc.setFont('helvetica', 'normal');
	const cidade = gise.seccionais.find((s: any) => s.seccional_id === seccionalId)?.seccional_nome.split('-')[1]?.trim() || 'Iguatu';
	doc.text(`${cidade}/CE, ${formatarData(gise.data_inicio)}.`, pageWidth - margin, sigY - 15, { align: 'right' });

	const sigCenterX = pageWidth / 2;

	if (!reportSignature) {
		if (!isPreparando) {
			doc.line(sigCenterX - 60, sigY, sigCenterX + 45, sigY);
			doc.setFont('helvetica', 'italic');
			doc.setFontSize(10);
			doc.text('Aguardando Conferência e Assinatura da Supervisão', sigCenterX, sigY + 8, { align: 'center' });
		}
	} else {
		if (reportSignature.rubrica) {
			try {
				const rubW = 65;
				const rubH = 25;
				const rubricaFormat = getImgFormat(reportSignature.rubrica) || 'PNG';
				doc.addImage(reportSignature.rubrica, rubricaFormat, sigCenterX - rubW / 2, sigY - rubH - 2, rubW, rubH);
			} catch (e) {
				console.warn('[relatorio-extra] Erro ao inserir rubrica do supervisor:', e);
			}
		}
		doc.line(sigCenterX - 45, sigY, sigCenterX + 45, sigY);
		doc.setFontSize(8);
		doc.setFont('helvetica', 'bold');
		doc.text((reportSignature.assinante_nome ?? 'Supervisão').toUpperCase(), sigCenterX, sigY + 4, { align: 'center' });
		doc.setFont('helvetica', 'normal');
		doc.text(`Matrícula: ${reportSignature.assinante_matricula ?? '—'}`, sigCenterX, sigY + 8, { align: 'center' });
		doc.text('Delegado(a) de Polícia / assinado digitalmente', sigCenterX, sigY + 12, { align: 'center' });
	}

	if (reportSignature && qrCodeBase64) {
		try {
			const qrSize = 14;
			const qrX = margin;
			const qrY = sigY - 2;
			doc.addImage(qrCodeBase64, 'PNG', qrX, qrY, qrSize, qrSize);

			const txtX = qrX + qrSize + 2;
			doc.setFontSize(6);
			doc.setFont('helvetica', 'bold');
			doc.text(`Confirmado eletronicamente por: ${(reportSignature.assinante_nome ?? '').toUpperCase()}`, txtX, qrY + 3);

			doc.setFont('helvetica', 'normal');
			const dataH = reportSignature.created_at ? new Date(reportSignature.created_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '';
			doc.text(`Data/Hora: ${dataH} | Código: ${reportSignature.verification_hash}`, txtX, qrY + 7);

			const cleanUrl = baseUrl?.replace(/^https?:\/\//, '') || 'escalas.pages.dev';
			doc.text(`Verificável em: ${cleanUrl}/validar/${reportSignature.verification_hash}`, txtX, qrY + 11);
		} catch (e) {
			console.warn('[relatorio-extra] Erro ao inserir QR code:', e);
		}
	}

	return { pdf: new Uint8Array(doc.output('arraybuffer')), finalY: sigY };
}

function getImgFormat(dataUrl: string): string | undefined {
	if (!dataUrl || typeof dataUrl !== 'string') return undefined;
	if (dataUrl.includes('image/png')) return 'PNG';
	if (dataUrl.includes('image/jpeg') || dataUrl.includes('image/jpg')) return 'JPEG';
	if (dataUrl.includes('image/webp')) return 'WEBP';
	return undefined;
}
