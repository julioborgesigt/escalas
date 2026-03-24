import {
	Document, Packer, Paragraph, Table, TableRow, TableCell,
	TextRun, WidthType, AlignmentType, BorderStyle, PageOrientation
} from 'docx';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { Escala, EscalaPolicialComDados } from './types';

interface DiaPlantao {
	data: string;
	policiais: EscalaPolicialComDados[];
}

function formatarData(dateStr: string): string {
	const [year, month, day] = dateStr.split('-');
	return `${day}/${month}/${year}`;
}

function proximoDia(dateStr: string): string {
	const d = new Date(dateStr + 'T00:00:00');
	d.setDate(d.getDate() + 1);
	return d.toISOString().split('T')[0];
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
			text: `ESCALA PLANTÃO FINAL DE SEMANA ${escala.cidade.toUpperCase()} ${formatarData(escala.data_inicio)} E ${formatarData(escala.data_fim)}`,
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
					width: text === 'EQUIPE DE PLANTÃO DA DP' ? { size: 3000, type: WidthType.DXA } :
						text === 'LOTAÇÃO' ? { size: 2500, type: WidthType.DXA } :
						text === 'DATA' ? { size: 2000, type: WidthType.DXA } :
							{ size: 1200, type: WidthType.DXA }
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
						orientation: PageOrientation.LANDSCAPE,
						width: 11906,
						height: 16838
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
export function gerarXlsx(escala: Escala, policiais: EscalaPolicialComDados[]): Uint8Array {
	const dias = agruparPorData(policiais);
	const wb = XLSX.utils.book_new();

	const rows: (string | null)[][] = [];
	rows.push([`ESCALA PLANTÃO FINAL DE SEMANA ${escala.cidade.toUpperCase()} ${formatarData(escala.data_inicio)} E ${formatarData(escala.data_fim)}`]);
	rows.push([]);

	for (const dia of dias) {
		rows.push(['EQUIPE DE PLANTÃO DA DP', 'MATRÍCULA', 'CARGO', 'TELEFONE', 'LOTAÇÃO', 'DATA', 'HORÁRIO']);
		for (const p of dia.policiais) {
			rows.push([
				p.nome,
				formatarMatricula(p.matricula),
				p.cargo,
				p.telefone || '',
				p.lotacao,
				formatarDataPlantao(p, escala),
				formatarHorario(p, escala)
			]);
		}
		rows.push([]);
	}

	const ws = XLSX.utils.aoa_to_sheet(rows);
	ws['!cols'] = [
		{ wch: 35 }, { wch: 15 }, { wch: 8 }, { wch: 18 }, { wch: 35 }, { wch: 22 }, { wch: 12 }
	];
	XLSX.utils.book_append_sheet(wb, ws, 'Escala');

	return new Uint8Array(XLSX.write(wb, { bookType: 'xlsx', type: 'array' }));
}

// ---- PDF ----
export function gerarPdf(escala: Escala, policiais: EscalaPolicialComDados[]): Uint8Array {
	const dias = agruparPorData(policiais);
	const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

	doc.setFontSize(14);
	doc.text(
		`ESCALA PLANTÃO FINAL DE SEMANA ${escala.cidade.toUpperCase()} ${formatarData(escala.data_inicio)} E ${formatarData(escala.data_fim)}`,
		148, 15, { align: 'center' }
	);

	let startY = 25;

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
			startY,
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

		startY = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY
			? (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable!.finalY + 10
			: startY + 50;
	}

	return new Uint8Array(doc.output('arraybuffer'));
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
					size: { orientation: PageOrientation.LANDSCAPE, width: 16838, height: 11906 },
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
export function gerarXlsxExpediente(escala: Escala, policiais: EscalaPolicialComDados[]): Uint8Array {
	const sorted = sortExpediente(policiais);
	const wb = XLSX.utils.book_new();
	const rows: (string | null)[][] = [
		[escala.titulo.toUpperCase()],
		[`Período: ${formatarData(escala.data_inicio)} a ${formatarData(escala.data_fim)}`],
		[],
		[...COLS_EXPEDIENTE],
		...sorted.map(p => rowExpediente(p))
	];
	const ws = XLSX.utils.aoa_to_sheet(rows);
	ws['!cols'] = [{ wch: 40 }, { wch: 15 }, { wch: 8 }, { wch: 18 }, { wch: 15 }, { wch: 35 }, { wch: 12 }, { wch: 35 }];
	XLSX.utils.book_append_sheet(wb, ws, 'Escala');
	return new Uint8Array(XLSX.write(wb, { bookType: 'xlsx', type: 'array' }));
}

// ---- ODS Expediente ----
export function gerarOdsExpediente(escala: Escala, policiais: EscalaPolicialComDados[]): Uint8Array {
	const sorted = sortExpediente(policiais);
	const wb = XLSX.utils.book_new();
	const rows: (string | null)[][] = [
		[escala.titulo.toUpperCase()],
		[`Período: ${formatarData(escala.data_inicio)} a ${formatarData(escala.data_fim)}`],
		[],
		[...COLS_EXPEDIENTE],
		...sorted.map(p => rowExpediente(p))
	];
	const ws = XLSX.utils.aoa_to_sheet(rows);
	XLSX.utils.book_append_sheet(wb, ws, 'Escala');
	return new Uint8Array(XLSX.write(wb, { bookType: 'ods', type: 'array' }));
}

// ---- PDF Expediente ----
export function gerarPdfExpediente(escala: Escala, policiais: EscalaPolicialComDados[]): Uint8Array {
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

	const lastY = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 190;

	// Footer
	const footerY = lastY + 15;
	doc.setFontSize(9);
	doc.setFont('helvetica', 'normal');
	doc.text(`${escala.cidade}, ______ de ________________ de ________`, margin, footerY);

	const sigY = footerY + 20;
	const sigCenterX = pageWidth / 2;
	doc.line(sigCenterX - 40, sigY, sigCenterX + 40, sigY);
	doc.setFontSize(8);
	doc.text('Assinatura / Carimbo', sigCenterX, sigY + 5, { align: 'center' });

	return new Uint8Array(doc.output('arraybuffer'));
}

// ---- ODS/ODT via XLSX (ODS format) ----
export function gerarOds(escala: Escala, policiais: EscalaPolicialComDados[]): Uint8Array {
	const dias = agruparPorData(policiais);
	const wb = XLSX.utils.book_new();

	const rows: (string | null)[][] = [];
	rows.push([`ESCALA PLANTÃO FINAL DE SEMANA ${escala.cidade.toUpperCase()} ${formatarData(escala.data_inicio)} E ${formatarData(escala.data_fim)}`]);
	rows.push([]);

	for (const dia of dias) {
		rows.push(['EQUIPE DE PLANTÃO DA DP', 'MATRÍCULA', 'CARGO', 'TELEFONE', 'LOTAÇÃO', 'DATA', 'HORÁRIO']);
		for (const p of dia.policiais) {
			rows.push([
				p.nome,
				formatarMatricula(p.matricula),
				p.cargo,
				p.telefone || '',
				p.lotacao,
				formatarDataPlantao(p, escala),
				formatarHorario(p, escala)
			]);
		}
		rows.push([]);
	}

	const ws = XLSX.utils.aoa_to_sheet(rows);
	XLSX.utils.book_append_sheet(wb, ws, 'Escala');

	return new Uint8Array(XLSX.write(wb, { bookType: 'ods', type: 'array' }));
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
	const [year, month] = dateStr.split('-');
	const meses = ['JANEIRO','FEVEREIRO','MARÇO','ABRIL','MAIO','JUNHO','JULHO','AGOSTO','SETEMBRO','OUTUBRO','NOVEMBRO','DEZEMBRO'];
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
					size: { orientation: PageOrientation.LANDSCAPE, width: 16838, height: 11906 },
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
export function gerarXlsxPlantao(escala: Escala, policiais: EscalaPolicialComDados[]): Uint8Array {
	const equipes = agruparPlantao(policiais);
	const wb = XLSX.utils.book_new();
	const rows: (string | null)[][] = [
		['POLÍCIA CIVIL DO ESTADO DO CEARÁ'],
		[`DELEGACIA: ${escala.cidade.toUpperCase()} — MÊS/ANO: ${formatarMesAno(escala.data_inicio)}`],
		[]
	];

	for (const [equipe, oficiais] of equipes) {
		rows.push([equipe ? `EQUIPE ${equipe}` : 'EQUIPE']);
		rows.push([...COLS_PLANTAO]);
		for (const o of oficiais) rows.push(rowPlantao(o));
		rows.push([]);
	}

	const ws = XLSX.utils.aoa_to_sheet(rows);
	ws['!cols'] = [{ wch: 40 }, { wch: 15 }, { wch: 8 }, { wch: 18 }, { wch: 35 }, { wch: 35 }, { wch: 30 }];
	XLSX.utils.book_append_sheet(wb, ws, 'Escala');
	return new Uint8Array(XLSX.write(wb, { bookType: 'xlsx', type: 'array' }));
}

// ---- ODS Plantão ----
export function gerarOdsPlantao(escala: Escala, policiais: EscalaPolicialComDados[]): Uint8Array {
	const equipes = agruparPlantao(policiais);
	const wb = XLSX.utils.book_new();
	const rows: (string | null)[][] = [
		['POLÍCIA CIVIL DO ESTADO DO CEARÁ'],
		[`DELEGACIA: ${escala.cidade.toUpperCase()} — MÊS/ANO: ${formatarMesAno(escala.data_inicio)}`],
		[]
	];

	for (const [equipe, oficiais] of equipes) {
		rows.push([equipe ? `EQUIPE ${equipe}` : 'EQUIPE']);
		rows.push([...COLS_PLANTAO]);
		for (const o of oficiais) rows.push(rowPlantao(o));
		rows.push([]);
	}

	const ws = XLSX.utils.aoa_to_sheet(rows);
	XLSX.utils.book_append_sheet(wb, ws, 'Escala');
	return new Uint8Array(XLSX.write(wb, { bookType: 'ods', type: 'array' }));
}

// ---- PDF Plantão ----
export function gerarPdfPlantao(escala: Escala, policiais: EscalaPolicialComDados[]): Uint8Array {
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
	doc.text(`DELEGACIA: ${escala.cidade.toUpperCase()}`, margin, y);
	doc.text(`MÊS/ANO: ${formatarMesAno(escala.data_inicio)}`, pageWidth / 2, y);
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

		y = ((doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y) + 6;
	}

	// Footer
	const footerY = y + 10;
	doc.setFontSize(8);
	doc.setFont('helvetica', 'normal');
	doc.text('Obs.: Escala sujeita a alteração conforme necessidade do serviço.', margin, footerY);
	const sigY = footerY + 14;
	doc.text(`${escala.cidade}, ______ de ________________ de ________`, margin, sigY);
	const sigCenterX = pageWidth * 0.75;
	doc.line(sigCenterX - 45, sigY + 12, sigCenterX + 45, sigY + 12);
	doc.setFontSize(7);
	doc.text('Delegado(a) de Polícia / Carimbo', sigCenterX, sigY + 17, { align: 'center' });

	return new Uint8Array(doc.output('arraybuffer'));
}
