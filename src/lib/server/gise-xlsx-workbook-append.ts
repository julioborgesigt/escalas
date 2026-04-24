/**
 * Monta o workbook XLSX do download por GISE (`/api/gise/[id]/download?format=xlsx`),
 * com suporte a agregar várias GISE na mesma planilha (histórico filtrado).
 * Abas: Base_Equipe + uma por seccional (sem aba Resumo Geral).
 */
import ExcelJS from 'exceljs';
import type { Database } from '$lib/db/core';
import type { GiseDetalhado } from '$lib/db/gise/types';
import {
	BASE_EQUIPE_PLANILHA_HEADERS,
	montarLinhasBaseEquipeGise
} from '$lib/db/gise/planilha-base-equipe-dados';

export const HEADERS_DETALHE_EQUIPE = [
	'Nome',
	'Cargo',
	'Matrícula',
	'Telefone',
	'Lotação',
	'Data Início',
	'Hora Início',
	'Data Término',
	'Hora Término'
] as const;

export function fmtDateGiseXlsx(iso: string): string {
	if (!iso) return '';
	const [y, m, d] = iso.split('-');
	return `${d}/${m}/${y}`;
}

export function fmtHoraGiseXlsx(h: string | number | null | undefined): string {
	if (h == null || h === '') return '';
	if (String(h).includes(':')) return String(h);
	const n = parseInt(String(h), 10);
	if (Number.isNaN(n)) return String(h);
	return `${String(n).padStart(2, '0')}:00`;
}

export function statusLabelGiseXlsx(status: string): string {
	const m: Record<string, string> = {
		em_definicao_supervisor: 'Em definição da supervisão',
		em_preenchimento: 'Preenchendo escalados',
		aguardando_assinatura: 'Aguardando assinatura da supervisão',
		em_andamento: 'GISE em operação',
		aguardando_relatorios: 'Aguardando relatórios',
		aguardando_assinatura_relat: 'Aguardando assinatura dos Rel. de Extra',
		pronta_para_finalizar: 'Pronta para finalizar',
		finalizada: 'Concluída'
	};
	return m[status] ?? status;
}

export type AppendGiseXlsxState = {
	usedWorksheetNames: Set<string>;
};

export function createAppendGiseXlsxState(): AppendGiseXlsxState {
	return { usedWorksheetNames: new Set<string>() };
}

function styleTitle(ws: ExcelJS.Worksheet, row: ExcelJS.Row, color: string) {
	row.height = 25;
	row.eachCell((cell) => {
		cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
		cell.font = { color: { argb: 'FFFFFFFF' }, bold: true, size: 12 };
		cell.alignment = { vertical: 'middle', horizontal: 'center' };
	});
}

function styleHeader(row: ExcelJS.Row) {
	row.height = 20;
	row.eachCell((cell) => {
		cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } };
		cell.font = { bold: true, size: 10 };
		cell.alignment = { vertical: 'middle', horizontal: 'center' };
		cell.border = {
			top: { style: 'thin' },
			left: { style: 'thin' },
			bottom: { style: 'thin' },
			right: { style: 'thin' }
		};
	});
}

function uniqueSeccionalSheetName(nome: string, giseId: number, used: Set<string>): string {
	const cleaned = nome.replace(/[:\\/?*[\]]/g, '').trim() || 'Seccional';
	let candidate = `${cleaned}_${giseId}`.slice(0, 31);
	let i = 0;
	while (used.has(candidate)) {
		i++;
		candidate = `${cleaned.slice(0, 18)}_${giseId}_${i}`.slice(0, 31);
	}
	used.add(candidate);
	return candidate;
}

function seccionalSheetName(
	secNome: string,
	giseId: number,
	multiEscala: boolean,
	used: Set<string>
): string {
	const cleanedBase = secNome.replace(/[:\\/?*[\]]/g, ' ').trim() || 'Seccional';
	if (!multiEscala) {
		const n = cleanedBase.slice(0, 31);
		if (used.has(n)) return uniqueSeccionalSheetName(secNome, giseId, used);
		used.add(n);
		return n;
	}
	return uniqueSeccionalSheetName(secNome, giseId, used);
}

/** Cabeçalho comum nas abas por seccional: quadro de supervisão + assessor + SEINT OIP. */
function addCabecalhoSupervisaoNaAbaSeccional(
	ws: ExcelJS.Worksheet,
	gise: GiseDetalhado,
	sec: { seccional_nome: string; status: string },
	multiEscala: boolean
) {
	ws.addRow([`SECCIONAL: ${sec.seccional_nome}`]).font = { bold: true, size: 14 };
	if (multiEscala) {
		ws.addRow([`GISE #${gise.id} · ${fmtDateGiseXlsx(gise.data_inicio)}`]).font = { size: 10 };
	}
	ws.addRow([`Data da escala: ${fmtDateGiseXlsx(gise.data_inicio)}`]);
	ws.addRow([`Horário: ${gise.hora_entrada} às ${gise.hora_saida}`]);
	ws.addRow([`Supervisor(a): ${gise.supervisor_nome ?? '—'}`]);
	ws.addRow([`Assessor(a): ${gise.assessor_nome ?? '—'}`]);
	ws.addRow([`SEINT OIP 1: ${gise.seint1_nome ?? '—'}`]);
	ws.addRow([`SEINT OIP 2: ${gise.seint2_nome ?? '—'}`]);
	ws.addRow([`Status da escala: ${statusLabelGiseXlsx(gise.status)}`]);
	if (gise.documento?.assinante_nome) {
		ws.addRow([`Assinado por: ${gise.documento.assinante_nome}`]);
	}
	ws.addRow([
		`Preenchimento desta seccional: ${sec.status === 'preenchida' ? 'Preenchida' : 'Pendente'}`
	]);
	ws.addRow([]);
}

export type AppendGiseXlsxOptions = {
	/** Várias GISE no mesmo arquivo: nomes de abas por seccional únicos (sufixo id). */
	multiEscala?: boolean;
};

/**
 * Acrescenta ao workbook as abas Base_Equipe e uma aba por seccional (detalhe por equipe).
 */
export async function appendGiseDetalhadoToXlsxWorkbook(
	wb: ExcelJS.Workbook,
	db: Database,
	gise: GiseDetalhado,
	state: AppendGiseXlsxState,
	options: AppendGiseXlsxOptions = {}
): Promise<void> {
	const multiEscala = !!options.multiEscala;
	const linhasBaseEquipePlanilha = await montarLinhasBaseEquipeGise(db, gise.id);

	const nColsBaseEquipe = BASE_EQUIPE_PLANILHA_HEADERS.length;
	let wsBaseEquipe = wb.getWorksheet('Base_Equipe');
	if (!wsBaseEquipe) {
		wsBaseEquipe = wb.addWorksheet('Base_Equipe');
		wsBaseEquipe.columns = Array.from({ length: nColsBaseEquipe }, () => ({ width: 18 }));
		const baseHeaderRow = wsBaseEquipe.addRow([...BASE_EQUIPE_PLANILHA_HEADERS]);
		styleHeader(baseHeaderRow);
	}
	if (linhasBaseEquipePlanilha && linhasBaseEquipePlanilha.length > 0) {
		for (const linha of linhasBaseEquipePlanilha) {
			wsBaseEquipe.addRow(linha);
		}
	}

	for (const sec of gise.seccionais ?? []) {
		const sheetNm = seccionalSheetName(sec.seccional_nome, gise.id, multiEscala, state.usedWorksheetNames);
		const ws = wb.addWorksheet(sheetNm);
		ws.columns = [
			{ width: 35 },
			{ width: 10 },
			{ width: 15 },
			{ width: 18 },
			{ width: 35 },
			{ width: 15 },
			{ width: 12 },
			{ width: 15 },
			{ width: 12 }
		];

		addCabecalhoSupervisaoNaAbaSeccional(ws, gise, sec, multiEscala);

		for (const unidade of sec.unidades ?? []) {
			for (const equipe of unidade.equipes ?? []) {
				const unitTitle = unidade.nome || sec.seccional_nome;
				const titleRow = ws.addRow([unitTitle]);
				ws.mergeCells(titleRow.number, 1, titleRow.number, HEADERS_DETALHE_EQUIPE.length);
				styleTitle(ws, titleRow, equipe.tipo === 'operacional' ? 'FF1A5C57' : 'FF3B3B76');

				const headerRow = ws.addRow([...HEADERS_DETALHE_EQUIPE]);
				styleHeader(headerRow);

				const hEnt = equipe.hora_entrada || sec.hora_entrada || gise.hora_entrada;
				const hSai = equipe.hora_saida || sec.hora_saida || gise.hora_saida;

				if (equipe.membros?.length) {
					for (const m of equipe.membros) {
						ws.addRow([
							m.policial_nome,
							m.policial_cargo,
							m.policial_matricula,
							m.policial_telefone || '—',
							m.policial_lotacao ?? '—',
							fmtDateGiseXlsx(gise.data_inicio),
							fmtHoraGiseXlsx(hEnt),
							fmtDateGiseXlsx(gise.data_inicio),
							fmtHoraGiseXlsx(hSai)
						]);
					}
				} else {
					ws.addRow(['(sem membros alocados)', '', '', '', '', '', '', '', '']);
				}
				ws.addRow([]);
			}
		}
	}
}
