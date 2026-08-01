/**
 * Geração dos .xlsx de escala (FDS, expediente e plantão mensal).
 *
 * Mesma dupla do DOCX: formato de trabalho para as unidades, enquanto o PDF é o
 * documento oficial. Os agrupamentos e a ordem dos nomes vêm de
 * `export-shared.ts`, garantindo que planilha, DOCX e PDF descrevam a mesma
 * escala.
 */
import ExcelJS from 'exceljs';
import type { Escala, EscalaPolicialComDados } from '../../types';
import { formatarData, formatarDataExtenso } from '../../utils';
import {
	sepDatas,
	agruparPorData,
	formatarDataPlantao,
	formatarHorario,
	sortExpediente,
	COLS_EXPEDIENTE,
	rowExpediente,
	agruparPlantao,
	COLS_PLANTAO,
	rowPlantao,
	formatarMesAno
} from './export-shared';

// ---- XLSX Final de Semana ----
/** Uma faixa de cabeçalho por dia, com as larguras de coluna fixadas em caracteres. */
export async function gerarXlsx(
	escala: Escala,
	policiais: EscalaPolicialComDados[]
): Promise<Uint8Array> {
	const dias = agruparPorData(policiais);
	const wb = new ExcelJS.Workbook();
	const ws = wb.addWorksheet('Escala');
	ws.columns = [
		{ width: 35 },
		{ width: 15 },
		{ width: 8 },
		{ width: 18 },
		{ width: 35 },
		{ width: 22 },
		{ width: 12 }
	];
	ws.addRow([
		`ESCALA PLANTÃO FINAL DE SEMANA ${escala.lotacao.toUpperCase()} ${formatarData(escala.data_inicio)} ${sepDatas(escala.data_inicio, escala.data_fim)} ${formatarData(escala.data_fim)}`
	]);
	ws.addRow([]);

	for (const dia of dias) {
		ws.addRow([
			'EQUIPE DE PLANTÃO DA DP',
			'MATRÍCULA',
			'CARGO',
			'TELEFONE',
			'LOTAÇÃO',
			'DATA',
			'HORÁRIO'
		]);
		for (const p of dia.policiais) {
			ws.addRow([
				p.nome,
				p.matricula,
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

// ---- XLSX Expediente ----
/**
 * Reproduz o cabeçalho institucional do documento oficial (brasão em texto,
 * título, mês/ano) com `mergeCells` sobre a largura da tabela, para que a
 * planilha impressa fique igual ao PDF.
 */
export async function gerarXlsxExpediente(
	escala: Escala,
	policiais: EscalaPolicialComDados[]
): Promise<Uint8Array> {
	const sorted = sortExpediente(policiais);
	const wb = new ExcelJS.Workbook();
	const ws = wb.addWorksheet('Escala', {
		pageSetup: {
			orientation: 'landscape',
			paperSize: 9,
			fitToPage: true,
			fitToWidth: 1,
			fitToHeight: 0
		}
	});
	const NCOLS = COLS_EXPEDIENTE.length;
	const lastCol = String.fromCharCode(64 + NCOLS); // 'H' for 8 cols

	ws.columns = [
		{ width: 40 },
		{ width: 18 },
		{ width: 10 },
		{ width: 22 },
		{ width: 12 },
		{ width: 28 },
		{ width: 16 },
		{ width: 35 }
	];

	const tealFill: ExcelJS.Fill = {
		type: 'pattern',
		pattern: 'solid',
		fgColor: { argb: 'FF1a5c57' }
	};
	const lightFill: ExcelJS.Fill = {
		type: 'pattern',
		pattern: 'solid',
		fgColor: { argb: 'FFF5F5F5' }
	};
	const thinBorder: Partial<ExcelJS.Border> = { style: 'thin', color: { argb: 'FF888888' } };
	const cellBorder = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder };

	function applyTeal(row: ExcelJS.Row, bold = true) {
		row.eachCell({ includeEmpty: true }, (cell) => {
			cell.fill = tealFill;
			cell.font = { bold, color: { argb: 'FFFFFFFF' }, name: 'Arial', size: 10 };
			cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
			cell.border = cellBorder;
		});
	}

	function applyMeta(row: ExcelJS.Row) {
		row.eachCell({ includeEmpty: true }, (cell) => {
			cell.font = { bold: true, name: 'Arial', size: 10 };
			cell.alignment = { horizontal: 'left', vertical: 'middle' };
			cell.border = cellBorder;
		});
	}

	const r1 = ws.addRow(['POLÍCIA CIVIL DO CEARÁ']);
	ws.mergeCells(`A${r1.number}:${lastCol}${r1.number}`);
	r1.getCell(1).font = { bold: true, name: 'Arial', size: 12 };
	r1.getCell(1).alignment = { horizontal: 'center' };

	const r2 = ws.addRow(['DELEGACIA GERAL DA POLÍCIA CIVIL']);
	ws.mergeCells(`A${r2.number}:${lastCol}${r2.number}`);
	r2.getCell(1).font = { name: 'Arial', size: 10 };
	r2.getCell(1).alignment = { horizontal: 'center' };

	const r3 = ws.addRow(['DEPARTAMENTO DE POLÍCIA DO INTERIOR SUL']);
	ws.mergeCells(`A${r3.number}:${lastCol}${r3.number}`);
	r3.getCell(1).font = { name: 'Arial', size: 10 };
	r3.getCell(1).alignment = { horizontal: 'center' };

	const rTit = ws.addRow(['ESCALA DE EXPEDIENTE']);
	ws.mergeCells(`A${rTit.number}:${lastCol}${rTit.number}`);
	applyTeal(rTit);
	rTit.height = 20;

	const rDel = ws.addRow([`DELEGACIA: ${escala.lotacao.toUpperCase()}`]);
	ws.mergeCells(`A${rDel.number}:${lastCol}${rDel.number}`);
	applyMeta(rDel);

	const rMes = ws.addRow([`MÊS/ANO: ${formatarMesAno(escala.data_inicio)}`]);
	ws.mergeCells(`A${rMes.number}:${lastCol}${rMes.number}`);
	applyMeta(rMes);

	const rCols = ws.addRow([...COLS_EXPEDIENTE]);
	applyTeal(rCols);
	rCols.height = 18;

	for (const p of sorted) {
		const rData = ws.addRow(rowExpediente(p));
		rData.eachCell({ includeEmpty: true }, (cell, col) => {
			cell.font = { name: 'Arial', size: 9 };
			cell.alignment = {
				horizontal: col >= 2 && col <= 5 ? 'center' : 'left',
				vertical: 'middle',
				wrapText: true
			};
			cell.border = cellBorder;
		});
	}

	const obsText =
		'OBSERVAÇÕES: FÉRIAS (INFORMAR PERÍODO DE INÍCIO/FIM); LICENÇAS (INFORMAR PERÍODO DE INÍCIO/FIM E ANEXAR A DOCUMENTAÇÃO RELACIONADA).';
	const rObs = ws.addRow([obsText]);
	ws.mergeCells(`A${rObs.number}:${lastCol}${rObs.number}`);
	rObs.getCell(1).fill = lightFill;
	rObs.getCell(1).font = { bold: true, name: 'Arial', size: 9 };
	rObs.getCell(1).alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
	rObs.getCell(1).border = cellBorder;
	rObs.height = 30;

	ws.addRow([]);
	const localizacao = escala.cidade && escala.cidade !== escala.lotacao ? escala.cidade : '';
	const dataExtenso = formatarDataExtenso(new Date());
	const textoData = localizacao ? `${localizacao}, ${dataExtenso}` : dataExtenso;
	const rData2 = ws.addRow([textoData]);
	rData2.getCell(1).font = { bold: true, name: 'Arial', size: 10 };

	const out = await wb.xlsx.writeBuffer();
	return new Uint8Array(out as ArrayBuffer);
}

// ---- XLSX Plantão ----
/** Um bloco por equipe; a coluna DIAS concentra todos os plantões do policial. */
export async function gerarXlsxPlantao(
	escala: Escala,
	policiais: EscalaPolicialComDados[]
): Promise<Uint8Array> {
	const equipes = agruparPlantao(policiais);
	const wb = new ExcelJS.Workbook();
	const ws = wb.addWorksheet('Escala');
	ws.columns = [
		{ width: 40 },
		{ width: 15 },
		{ width: 8 },
		{ width: 18 },
		{ width: 35 },
		{ width: 35 },
		{ width: 30 }
	];
	ws.addRow(['POLÍCIA CIVIL DO ESTADO DO CEARÁ']);
	ws.addRow([
		`DELEGACIA: ${escala.cidade.toUpperCase()} — MÊS/ANO: ${formatarMesAno(escala.data_inicio)}`
	]);
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
