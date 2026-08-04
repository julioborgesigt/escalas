/**
 * `GET /api/gise/historico/export` — exporta o histórico de GISEs FINALIZADAS
 * em XLSX (uma aba por escala) ou PDF (relatório corrido). Restrito ao Admin
 * Geral, e sempre auditado com os filtros usados: exportar histórico é levar
 * dado pessoal de muita gente para fora do sistema.
 *
 * A filtragem por PERÍODO tem três formas, e só a primeira é trivial:
 *   - `mesAno` — mês calendário;
 *   - `ciclo` — o ciclo da corporação, que NÃO é o mês: vai do dia 21 do mês
 *     anterior ao dia 20 (`getCicloRange`), e o ciclo 1 atravessa o ano;
 *   - `data` — um dia específico.
 *
 * Só entram escalas `finalizada`. O histórico é o que já se encerrou; escala em
 * andamento muda depois da exportação e o arquivo passaria a mentir.
 *
 * O nome da seccional para o cabeçalho vem do resultado já carregado e só custa
 * consulta quando o filtro aponta para uma seccional que não aparece nele.
 */
import type { RequestHandler } from './$types';
import { getDB, listarGiseEscalas, buscarGiseDetalhado } from '$lib/db';
import { registrarAuditComContexto } from '$lib/db/audit';
import { giseHistoricoExportQuerySchema } from '$lib/schemas';
import { dataHoraBrasilia } from '$lib/utils/datas';
import {
	contentDisposition,
	requireAdmin,
	badRequest,
	notFound,
	serverError
} from '$lib/server/api';
import { unidades } from '$lib/server/schema';
import { eq } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { GiseDetalhado } from '$lib/db/gise/types';
import { getCicloRange } from '$lib/gise/ciclos';
import {
	appendGiseDetalhadoToXlsxWorkbook,
	createAppendGiseXlsxState,
	fmtDateGiseXlsx,
	fmtHoraGiseXlsx,
	HEADERS_DETALHE_EQUIPE,
	statusLabelGiseXlsx
} from '$lib/server/gise/xlsx-workbook-append';

/** `jspdf-autotable` injeta `lastAutoTable` em tempo de execução, fora do .d.ts. */
interface JsPDFWithAutoTable extends jsPDF {
	lastAutoTable?: { finalY: number };
}

async function buildHistoricoPdfBuffer(
	gises: GiseDetalhado[],
	seccionalNome: string,
	periodoLabel: string
): Promise<ArrayBuffer> {
	const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
	let y = 14;

	doc.setFontSize(14);
	doc.setFont('helvetica', 'bold');
	doc.text('GISE — export do histórico', 14, y);
	y += 8;
	doc.setFont('helvetica', 'normal');
	doc.setFontSize(9);
	doc.text(`Seccional: ${seccionalNome}`, 14, y);
	y += 5;
	doc.text(`Período: ${periodoLabel}`, 14, y);
	y += 5;
	doc.text(`Gerado em: ${dataHoraBrasilia(new Date())}`, 14, y);
	y += 10;

	if (gises.length === 0) {
		doc.setFontSize(10);
		doc.text('Nenhuma escala GISE detalhada neste filtro.', 14, y);
		return doc.output('arraybuffer');
	}

	/** Quebra a página quando não sobra `minSpace` mm até o rodapé (A4 = 297 mm). */
	const bumpY = (docu: jsPDF, cur: number, minSpace = 36): number => {
		if (cur > 270 - minSpace) {
			docu.addPage();
			return 14;
		}
		return cur;
	};

	for (const gise of gises) {
		y = bumpY(doc, y, 40);
		doc.setFontSize(11);
		doc.setFont('helvetica', 'bold');
		doc.text(`GISE #${gise.id} — ${fmtDateGiseXlsx(gise.data_inicio)}`, 14, y);
		y += 6;
		doc.setFont('helvetica', 'normal');
		doc.setFontSize(9);
		const meta = [
			`Horário: ${gise.hora_entrada} às ${gise.hora_saida}`,
			`Supervisor(a): ${gise.supervisor_nome ?? '—'}`,
			`Assessor(a): ${gise.assessor_nome ?? '—'}`,
			`SEINT OIP 1: ${gise.seint1_nome ?? '—'}`,
			`SEINT OIP 2: ${gise.seint2_nome ?? '—'}`,
			`Status da escala: ${statusLabelGiseXlsx(gise.status)}`
		];
		if (gise.documento?.assinante_nome) {
			meta.push(`Assinado por: ${gise.documento.assinante_nome}`);
		}
		for (const line of meta) {
			y = bumpY(doc, y, 8);
			doc.text(line, 14, y);
			y += 4;
		}
		y += 4;

		for (const sec of gise.seccionais ?? []) {
			for (const unidade of sec.unidades ?? []) {
				for (const equipe of unidade.equipes ?? []) {
					const teamTitle = `${unidade.nome || sec.seccional_nome} — ${equipe.tipo === 'operacional' ? 'Operacional' : 'SEINT'}`;
					// Horário em cascata: equipe > seccional > escala (o mais específico vence).
					const hEnt = equipe.hora_entrada || sec.hora_entrada || gise.hora_entrada;
					const hSai = equipe.hora_saida || sec.hora_saida || gise.hora_saida;

					const body: string[][] = equipe.membros?.length
						? equipe.membros.map((m) => [
								m.policial_nome,
								m.policial_cargo,
								m.policial_matricula,
								m.policial_telefone || '—',
								m.policial_lotacao ?? '—',
								fmtDateGiseXlsx(gise.data_inicio),
								fmtHoraGiseXlsx(hEnt),
								fmtDateGiseXlsx(gise.data_inicio),
								fmtHoraGiseXlsx(hSai)
							])
						: [['(sem membros alocados)', '', '', '', '', '', '', '', '']];

					y = bumpY(doc, y, 28);
					doc.setFontSize(8);
					doc.setFont('helvetica', 'bold');
					doc.text(teamTitle, 14, y);
					y += 3;
					doc.setFont('helvetica', 'normal');
					autoTable(doc, {
						startY: y,
						head: [[...HEADERS_DETALHE_EQUIPE]],
						body,
						styles: { fontSize: 7, cellPadding: 1.2 },
						headStyles: { fillColor: [26, 92, 87] },
						margin: { left: 14, right: 14 },
						tableWidth: 'auto'
					});
					y = ((doc as JsPDFWithAutoTable).lastAutoTable?.finalY ?? y) + 8;
				}
			}
		}
	}

	return doc.output('arraybuffer');
}

export const GET: RequestHandler = async ({ locals, platform, url }) => {
	const u = requireAdmin(locals);
	if (u instanceof Response) return u;

	const parsed = giseHistoricoExportQuerySchema.safeParse(Object.fromEntries(url.searchParams));
	if (!parsed.success) {
		const msg = parsed.error.issues[0]?.message ?? 'Parâmetros inválidos';
		return badRequest(msg);
	}
	const { format, seccionalId, periodo, mesAno, ano, ciclo, data: dataEspecifica } = parsed.data;

	type EscalaLista = Awaited<ReturnType<typeof listarGiseEscalas>>[number];

	const db = getDB(platform);
	// Só escala finalizada entra no histórico — as em andamento saem pelos
	// downloads da própria GISE.
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
		} else if (periodo === 'data' && dataEspecifica) {
			if (String(e.data_inicio) !== dataEspecifica) return false;
		}
		return true;
	});

	if (filtradas.length === 0) {
		return notFound('Escala finalizada para o filtro informado');
	}

	await registrarAuditComContexto(db, {
		usuario: u,
		acao: 'exportar_gise',
		entidade: 'gise_historico',
		detalhes: `Formato: ${format} · Filtros: ${JSON.stringify({ seccionalId, periodo, mesAno, ano, ciclo, data: dataEspecifica })}`
	});

	// Nome da seccional para o cabeçalho: aproveita o que já veio na listagem e
	// só vai ao banco se o filtro apontar para uma seccional fora do resultado.
	let seccionalNome = 'Todas as seccionais';
	if (seccionalId !== undefined) {
		const fromEscala = (filtradas[0]?.seccionais ?? []).find((s) => s.id === seccionalId)?.nome;
		if (fromEscala) {
			seccionalNome = fromEscala;
		} else {
			const row = await db
				.select({ nome: unidades.nome })
				.from(unidades)
				.where(eq(unidades.id, seccionalId))
				.get();
			seccionalNome = row?.nome ?? `Seccional #${seccionalId}`;
		}
	}

	const periodoLabel =
		periodo === 'mes' && mesAno
			? `Mês ${mesAno}`
			: periodo === 'ciclo' && ano !== undefined && ciclo !== undefined
				? `Ano ${ano} · Ciclo ${ciclo}`
				: periodo === 'data' && dataEspecifica
					? `Data ${dataEspecifica}`
					: 'Período';

	const ordenadas = [...filtradas].sort((a, b) => {
		const d = String(b.data_inicio).localeCompare(String(a.data_inicio));
		if (d !== 0) return d;
		return Number(b.id) - Number(a.id);
	});

	// Uma consulta detalhada por escala (a listagem não traz equipes/membros).
	// Sequencial de propósito: o D1 serializa as queries e o paralelo só
	// aumentaria a chance de estourar o limite de subrequests do Worker.
	const gisesDetalhadas: GiseDetalhado[] = [];
	for (const e of ordenadas) {
		const g = await buscarGiseDetalhado(db, e.id);
		if (g) gisesDetalhadas.push(g);
	}

	if (gisesDetalhadas.length === 0) {
		return serverError(
			'[gise/historico/export] Não foi possível carregar os dados das escalas para exportação',
			new Error('GISE_DETALHADAS_EMPTY')
		);
	}

	// Sufixo do nome do arquivo, derivado do filtro (sem caracteres de caminho).
	const safeSlug =
		periodo === 'mes' && mesAno
			? mesAno.replace('-', '')
			: periodo === 'data' && dataEspecifica
				? `d${dataEspecifica.replace(/-/g, '')}`
				: periodo === 'ciclo' && ano !== undefined && ciclo !== undefined
					? `c${ciclo}_a${ano}`
					: 'export';

	if (format === 'xlsx') {
		try {
			const wb = new ExcelJS.Workbook();
			const state = createAppendGiseXlsxState();
			for (const gise of gisesDetalhadas) {
				await appendGiseDetalhadoToXlsxWorkbook(wb, db, gise, state, { multiEscala: true });
			}
			const raw = await wb.xlsx.writeBuffer();
			const buffer = new Uint8Array(raw as ArrayBuffer);
			const filename = `gise_historico_${safeSlug}.xlsx`;
			return new Response(buffer, {
				headers: {
					'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
					'Content-Disposition': contentDisposition(filename),
					'Cache-Control': 'no-cache'
				}
			});
		} catch (e) {
			return serverError('[gise/historico/export] Falha ao gerar a planilha', e);
		}
	}

	const pdfBytes = await buildHistoricoPdfBuffer(gisesDetalhadas, seccionalNome, periodoLabel);
	const filenamePdf = `gise_historico_${safeSlug}.pdf`;
	return new Response(new Uint8Array(pdfBytes as ArrayBuffer), {
		headers: {
			'Content-Type': 'application/pdf',
			'Content-Disposition': contentDisposition(filenamePdf),
			'Cache-Control': 'no-cache'
		}
	});
};
