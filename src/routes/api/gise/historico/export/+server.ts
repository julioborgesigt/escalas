import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDB, listarGiseEscalas } from '$lib/db';
import { isAdminGeral } from '$lib/auth';
import { giseHistoricoExportQuerySchema } from '$lib/schemas';
import { contentDisposition } from '$lib/server/api';
import { unidades } from '$lib/server/schema';
import { eq } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

function getCicloRange(ano: number, ciclo: number): { inicio: string; fim: string } {
	if (ciclo === 1) return { inicio: `${ano - 1}-12-21`, fim: `${ano}-01-20` };
	const mI = String(ciclo - 1).padStart(2, '0');
	const mF = String(ciclo).padStart(2, '0');
	return { inicio: `${ano}-${mI}-21`, fim: `${ano}-${mF}-20` };
}

const STATUS_LABEL: Record<string, string> = {
	em_definicao_supervisor: 'Em definição do supervisor',
	em_preenchimento: 'Preenchendo escalados',
	aguardando_assinatura: 'Aguardando assinatura do supervisor',
	em_andamento: 'GISE em operação',
	aguardando_relatorios: 'Aguardando entradas',
	aguardando_assinatura_relat: 'Aguardando assinatura dos Rel. de Extra',
	pronta_para_finalizar: 'Pronta para finalizar',
	finalizada: 'Concluída'
};

function fmtDate(iso: string): string {
	if (!iso) return '';
	const [y, m, d] = iso.split('-');
	return `${d}/${m}/${y}`;
}

export const GET: RequestHandler = async ({ locals, platform, url }) => {
	const u = locals.usuario;
	if (!u) return json({ error: 'Não autenticado' }, { status: 401 });
	if (!isAdminGeral(u)) {
		return json({ error: 'Apenas o Administrador Geral pode exportar o histórico.' }, { status: 403 });
	}

	const parsed = giseHistoricoExportQuerySchema.safeParse(Object.fromEntries(url.searchParams));
	if (!parsed.success) {
		const msg = parsed.error.issues[0]?.message ?? 'Parâmetros inválidos';
		return json({ error: msg }, { status: 400 });
	}
	const { format, seccionalId, periodo, mesAno, ano, ciclo } = parsed.data;

	type EscalaLista = Awaited<ReturnType<typeof listarGiseEscalas>>[number];

	const db = getDB(platform);
	const todas = await listarGiseEscalas(db);
	const historico = todas.filter((e) => e.status === 'finalizada');

	const filtradas = historico.filter((e: EscalaLista) => {
		if (seccionalId !== undefined && !(e.seccionais ?? []).some((sec) => sec.id === seccionalId)) {
			return false;
		}
		if (periodo === 'mes' && mesAno) {
			if (!String(e.data_inicio).startsWith(mesAno)) return false;
		} else if (periodo === 'ciclo' && ano !== undefined && ciclo !== undefined) {
			const { inicio, fim } = getCicloRange(ano, ciclo);
			if (String(e.data_inicio) < inicio || String(e.data_inicio) > fim) return false;
		}
		return true;
	});

	let seccionalNome = 'Todas as seccionais';
	if (seccionalId !== undefined) {
		const fromEscala = (filtradas[0]?.seccionais ?? []).find((s) => s.id === seccionalId)?.nome;
		if (fromEscala) {
			seccionalNome = fromEscala;
		} else {
			const row = await db.select({ nome: unidades.nome }).from(unidades).where(eq(unidades.id, seccionalId)).get();
			seccionalNome = row?.nome ?? `Seccional #${seccionalId}`;
		}
	}

	const periodoLabel =
		periodo === 'mes' && mesAno
			? `Mês ${mesAno}`
			: periodo === 'ciclo' && ano !== undefined && ciclo !== undefined
				? `Ano ${ano} · Ciclo ${ciclo}`
				: 'Período';

	const rows = filtradas.map((e: EscalaLista) => [
		e.id,
		fmtDate(e.data_inicio),
		`${e.hora_entrada} às ${e.hora_saida}`,
		STATUS_LABEL[e.status] ?? e.status,
		(e.seccionais ?? []).map((s) => s.nome).join('; ') || '—'
	]);

	if (format === 'xlsx') {
		const wb = new ExcelJS.Workbook();
		const ws = wb.addWorksheet('Histórico GISE');
		ws.columns = [{ width: 10 }, { width: 14 }, { width: 18 }, { width: 36 }, { width: 50 }];
		ws.addRow(['Histórico GISE — escalas finalizadas']).font = { bold: true, size: 14 };
		ws.addRow([`Seccional: ${seccionalNome}`]);
		ws.addRow([`Filtro de período: ${periodoLabel}`]);
		ws.addRow([`Gerado em: ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`]);
		ws.addRow([]);
		const header = ws.addRow(['ID', 'Data', 'Horário', 'Status', 'Seccionais']);
		header.font = { bold: true };
		for (const r of rows) ws.addRow(r);

		const buf = await wb.xlsx.writeBuffer();
		const safe = periodo === 'mes' && mesAno ? mesAno.replace('-', '') : `c${ciclo}_a${ano}`;
		const filename = `gise_historico_${safe}.xlsx`;
		return new Response(buf, {
			headers: {
				'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
				'Content-Disposition': contentDisposition(filename),
				'Cache-Control': 'no-cache'
			}
		});
	}

	// PDF
	const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
	doc.setFontSize(14);
	doc.text('Histórico GISE — escalas finalizadas', 14, 16);
	doc.setFontSize(10);
	doc.text(`Seccional: ${seccionalNome}`, 14, 24);
	doc.text(`Período: ${periodoLabel}`, 14, 30);
	doc.text(
		`Gerado em: ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`,
		14,
		36
	);
	autoTable(doc, {
		startY: 42,
		head: [['ID', 'Data', 'Horário', 'Status', 'Seccionais']],
		body: rows.length ? rows : [['—', '—', '—', 'Nenhuma escala neste filtro', '—']],
		styles: { fontSize: 8, cellPadding: 2 },
		headStyles: { fillColor: [26, 92, 87] },
		columnStyles: {
			0: { cellWidth: 14 },
			1: { cellWidth: 22 },
			2: { cellWidth: 28 },
			3: { cellWidth: 38 },
			4: { cellWidth: 52 }
		},
		margin: { left: 14, right: 14 }
	});

	const pdfBytes = doc.output('arraybuffer');
	const safePdf = periodo === 'mes' && mesAno ? mesAno.replace('-', '') : `c${ciclo}_a${ano}`;
	const filenamePdf = `gise_historico_${safePdf}.pdf`;
	return new Response(pdfBytes, {
		headers: {
			'Content-Type': 'application/pdf',
			'Content-Disposition': contentDisposition(filenamePdf),
			'Cache-Control': 'no-cache'
		}
	});
};
