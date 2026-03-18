import {
	Document, Packer, Paragraph, Table, TableRow, TableCell,
	TextRun, WidthType, AlignmentType, BorderStyle, HeadingLevel
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
	const he = Number(getHoraEntrada(p, escala));
	const hs = Number(getHoraSaida(p, escala));
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
					p.telefone,
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
					margin: { top: 720, bottom: 720, left: 720, right: 720 }
				}
			},
			children: [titulo, ...tables]
		}]
	});

	return Packer.toBuffer(doc);
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
				p.telefone,
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
			p.telefone,
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
				p.telefone,
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
