/**
 * PDF do RELATÓRIO DE SERVIÇO EXTRAORDINÁRIO da GISE, nas duas variantes:
 * por seccional e do quadro de supervisão.
 *
 * Saíram de `pdf.ts` por serem a única família com moldura PRÓPRIA: os blocos
 * abaixo (`iniciarRelatorioExtra`, `colunasPresencaRelatorio`,
 * `tabelaPresencasRelatorio`, `assinaturaRelatorioExtra`) são usados só pelas
 * duas variantes daqui, e nenhuma escala os toca. O que de fato é comum aos
 * dois arquivos — tipos da GISE, logos, formato de imagem — está em
 * `pdf-comum.ts`.
 *
 * **A saída é congelada por goldens** (`__tests__/pdf-goldens.test.ts`), como a
 * de `pdf.ts`. Vale a mesma regra: nunca regrave para "fazer o teste passar" —
 * estes documentos são prova documental.
 */
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { formatarData, calcularDataSaida, dataHoraBrasilia } from '../../utils/datas';
import { CORPORACAO, DEPARTAMENTO, DELEGACIA_GERAL } from '../../institucional';
import type { BreveRelatorioEnv } from '$lib/gise/breve-relatorio';
import {
	resolveBreveRelatorioTitulo,
	resolveBreveRelatorioConteudoSupervisao
} from '$lib/gise/breve-relatorio';
import {
	embutirLogosGise,
	getImgFormat,
	type GisePdfData,
	type GisePresenca,
	type JsPDFWithAutoTable,
	type PdfExportResult,
	type RelatorioAssinatura
} from './pdf-comum';
import { toGisePdfData } from './pdf';

// ---- PDF Relatório Extraordinário GISE (Seccional) ----
// ---- Blocos compartilhados dos relatórios de serviço extraordinário ----
// (seccional × supervisão: mesma diagramação, muda só unidade/título/local)

const REL_EXTRA_PAGE_WIDTH = 297;
const REL_EXTRA_MARGIN = 10;

/** Cabeçalho institucional + título + linha de DATA + caixa do breve relatório. */
function iniciarRelatorioExtra(opts: {
	linhaUnidade: string;
	titulo: string;
	data_inicio: string;
	hora_entrada: string;
	hora_saida: string;
	breveTitulo: string;
	breveConteudo: string;
}): { doc: jsPDF; y: number; dataSaidaEfetiva: string } {
	const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
	const pageWidth = REL_EXTRA_PAGE_WIDTH;
	const margin = REL_EXTRA_MARGIN;

	let y = 14;
	doc.setFontSize(11);
	doc.setFont('helvetica', 'bold');
	doc.text(CORPORACAO, pageWidth / 2, y, { align: 'center' });
	y += 5;
	doc.text(DELEGACIA_GERAL, pageWidth / 2, y, { align: 'center' });
	y += 5;
	doc.setFontSize(10);
	doc.text(DEPARTAMENTO, pageWidth / 2, y, { align: 'center' });
	y += 5;
	doc.text(opts.linhaUnidade, pageWidth / 2, y, { align: 'center' });
	y += 10;

	doc.setFontSize(12);
	doc.text(opts.titulo, pageWidth / 2, y, { align: 'center' });
	y += 10;

	const heVal = parseInt(opts.hora_entrada.split(':')[0]);
	const hsVal = parseInt(opts.hora_saida.split(':')[0]);
	const dataSaidaEfetiva = calcularDataSaida(opts.data_inicio, opts.hora_entrada, opts.hora_saida);
	let diff = hsVal - heVal;
	if (diff <= 0) diff += 24;

	doc.setFontSize(10);
	doc.setFont('helvetica', 'normal');
	const textoData = `DATA: das ${opts.hora_entrada} de ${formatarData(opts.data_inicio)} às ${opts.hora_saida} horas de ${formatarData(dataSaidaEfetiva)} (${diff} horas)`;
	doc.text(textoData, pageWidth / 2, y, { align: 'center' });
	y += 10;

	doc.text(opts.breveTitulo, margin, y);
	y += 5;
	doc.setFont('helvetica', 'bold');
	const boxY = y;
	doc.rect(margin, boxY, pageWidth - 20, 15);
	const splitText = doc.splitTextToSize(opts.breveConteudo, pageWidth - 30);
	doc.text(splitText, margin + 5, boxY + 7);
	y += 25;

	return { doc, y, dataSaidaEfetiva };
}

/** Colunas de presença (hora início/rubrica/hora saída/rubrica) de uma linha da tabela. */
function colunasPresencaRelatorio(
	dataInicio: string,
	dataSaidaEfetiva: string,
	pres:
		| Pick<
				GisePresenca,
				'entrada_timestamp' | 'entrada_rubrica' | 'saida_timestamp' | 'saida_rubrica'
		  >
		| null
		| undefined
) {
	const hora = (ts: string | null | undefined) =>
		ts
			? new Date(ts).toLocaleTimeString('pt-BR', {
					hour: '2-digit',
					minute: '2-digit',
					timeZone: 'America/Sao_Paulo'
				})
			: '';
	return [
		`${formatarData(dataInicio)}\n${hora(pres?.entrada_timestamp)}`,
		{ content: '', image: pres?.entrada_rubrica },
		`${formatarData(dataSaidaEfetiva)}\n${hora(pres?.saida_timestamp)}`,
		{ content: '', image: pres?.saida_rubrica }
	];
}

type LinhaRelatorio = Array<string | { content: string; image?: string | null }>;

/** Tabela de presenças com as rubricas desenhadas nas células 6 e 8. */
function tabelaPresencasRelatorio(doc: jsPDF, startY: number, body: LinhaRelatorio[]): number {
	autoTable(doc, {
		head: [
			[
				'NOME COMPLETO',
				'CARGO',
				'MATRÍCULA',
				'CLASSE',
				'LOTAÇÃO',
				'HORA DE INÍCIO',
				'RUBRICA',
				'HORA DE SAÍDA',
				'RUBRICA'
			]
		],
		body,
		startY,
		theme: 'grid',
		margin: { left: REL_EXTRA_MARGIN, right: REL_EXTRA_MARGIN },
		styles: { fontSize: 8, cellPadding: 2, halign: 'center', valign: 'middle', minCellHeight: 16 },
		headStyles: { fillColor: [200, 200, 200], textColor: 0, fontStyle: 'bold' },
		didDrawCell: (data) => {
			if ((data.column.index === 6 || data.column.index === 8) && data.cell.section === 'body') {
				const rawCell = data.cell.raw as { image?: string; content?: string } | string | null;
				const imgData = typeof rawCell === 'object' && rawCell !== null ? rawCell.image : rawCell;

				// Só tenta inserir se for uma string base64 com prefixo data:image/
				// Qualquer outro valor (URL, string sem prefixo, null) é ignorado
				// para evitar o quadrado preto gerado pelo jsPDF quando recebe dados inválidos
				const isValidBase64Image =
					typeof imgData === 'string' &&
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
	return (doc as JsPDFWithAutoTable).lastAutoTable?.finalY ?? startY;
}

/**
 * Bloco de assinatura da supervisão (+ QR de verificação quando assinado).
 * `matriculaTexto` já vem resolvido pelo caller (fallbacks diferem entre os
 * relatórios). Devolve o `sigY` usado.
 */
function assinaturaRelatorioExtra(
	doc: jsPDF,
	lastAutoY: number,
	opts: {
		localData: string;
		reportSignature?: RelatorioAssinatura | null;
		matriculaTexto: string;
		isPreparando: boolean;
		qrCodeBase64?: string;
		baseUrl?: string;
	}
): number {
	const pageWidth = REL_EXTRA_PAGE_WIDTH;
	const margin = REL_EXTRA_MARGIN;
	const { reportSignature, isPreparando, qrCodeBase64, baseUrl } = opts;

	let sigY = lastAutoY + 40;
	if (sigY > 185) {
		doc.addPage();
		sigY = 40;
	}

	doc.setFontSize(10);
	doc.setFont('helvetica', 'normal');
	doc.text(opts.localData, pageWidth - margin, sigY - 15, { align: 'right' });

	const sigCenterX = pageWidth / 2;

	if (!reportSignature) {
		if (!isPreparando) {
			doc.line(sigCenterX - 60, sigY, sigCenterX + 45, sigY);
			doc.setFont('helvetica', 'italic');
			doc.setFontSize(10);
			doc.text('Aguardando Conferência e Assinatura da Supervisão', sigCenterX, sigY + 8, {
				align: 'center'
			});
		}
	} else {
		if (reportSignature.rubrica) {
			try {
				const rubW = 65;
				const rubH = 25;
				const rubricaFormat = getImgFormat(reportSignature.rubrica) || 'PNG';
				doc.addImage(
					reportSignature.rubrica,
					rubricaFormat,
					sigCenterX - rubW / 2,
					sigY - rubH - 2,
					rubW,
					rubH
				);
			} catch (e) {
				console.warn('[relatorio-extra] Erro ao inserir rubrica do supervisor:', e);
			}
		}
		doc.line(sigCenterX - 45, sigY, sigCenterX + 45, sigY);
		doc.setFontSize(8);
		doc.setFont('helvetica', 'bold');
		doc.text((reportSignature.assinante_nome ?? 'Supervisão').toUpperCase(), sigCenterX, sigY + 4, {
			align: 'center'
		});
		doc.setFont('helvetica', 'normal');
		doc.text(`Matrícula: ${opts.matriculaTexto}`, sigCenterX, sigY + 8, { align: 'center' });
		doc.text('Delegado(a) de Polícia / assinado digitalmente', sigCenterX, sigY + 12, {
			align: 'center'
		});
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
			doc.text('Assinado eletronicamente por:', txtX, qrY + 3);
			doc.text((reportSignature.assinante_nome ?? '').toUpperCase(), txtX, qrY + 6.5);

			doc.setFont('helvetica', 'normal');
			const dataH = reportSignature.created_at ? dataHoraBrasilia(reportSignature.created_at) : '';
			doc.text(
				`Data/Hora: ${dataH} | Código: ${reportSignature.verification_hash}`,
				txtX,
				qrY + 10
			);

			const cleanUrl = baseUrl?.replace(/^https?:\/\//, '') || 'escalas.pages.dev';
			doc.text(
				`Verificável em: ${cleanUrl}/validar/${reportSignature.verification_hash}`,
				txtX,
				qrY + 14
			);
		} catch (e) {
			console.warn('[relatorio-extra] Erro ao inserir QR code:', e);
		}
	}

	return sigY;
}

/**
 * Gera o PDF do RELATÓRIO DE SERVIÇO EXTRAORDINÁRIO de uma seccional (ou do
 * quadro de supervisão), com a lista de quem serviu e os horários de entrada e
 * saída efetivos.
 *
 * `isPreparando = true` é a versão que vai ser ASSINADA: omite o placeholder
 * "Aguardando Conferência e Assinatura da Supervisão", deixando o espaço livre
 * para o carimbo visual que o fluxo de assinatura desenha depois. Com `false`
 * sai o documento de leitura — com o placeholder, ou com a assinatura já
 * registrada em `reportSignature`.
 *
 * O `finalY` devolvido é a coordenada dessa área: é por ele que o fluxo de
 * assinatura ancora rubrica e QR sem remedir o documento.
 *
 * Logos e QR chegam como bytes/base64 pelo chamador em vez de serem buscados
 * aqui: geração de PDF roda no Worker e não deve depender de rede nem de R2.
 */
export async function gerarRelatorioExtraordinarioPdf(
	gise: GisePdfData,
	presencas: GisePresenca[],
	seccionalId?: number,
	baseUrl?: string,
	reportSignature?: RelatorioAssinatura | null,
	qrCodeBase64?: string,
	isPreparando = false,
	logoEsqBytes?: Uint8Array,
	logoDirBytes?: Uint8Array
): Promise<PdfExportResult> {
	const primeiraSec =
		gise.seccionais.find((s) => s.seccional_id === seccionalId)?.seccional_nome ||
		gise.seccionais[0]?.seccional_nome ||
		'';
	const { doc, y, dataSaidaEfetiva } = iniciarRelatorioExtra({
		linhaUnidade: primeiraSec.toUpperCase(),
		titulo: 'RELATÓRIO DE SERVIÇO EXTRAORDINÁRIO',
		data_inicio: gise.data_inicio,
		hora_entrada: gise.hora_entrada,
		hora_saida: gise.hora_saida,
		breveTitulo: gise.breve_relatorio_titulo,
		breveConteudo: gise.breve_relatorio_conteudo
	});

	const allMembros: Array<
		GisePdfData['seccionais'][number]['equipes'][number]['membros'][number] & {
			seccional: string;
			presencaData: (typeof presencas)[number] | undefined;
		}
	> = [];
	for (const sec of gise.seccionais) {
		if (seccionalId && sec.seccional_id !== seccionalId) continue;
		for (const eq of sec.equipes) {
			for (const m of eq.membros) {
				const pres = presencas.find((p) => p.policial_id === m.policial_id);
				allMembros.push({ ...m, seccional: sec.seccional_nome, presencaData: pres });
			}
		}
	}

	const tableData: LinhaRelatorio[] = allMembros.map((m) => [
		m.policial_nome,
		m.policial_cargo,
		m.policial_matricula,
		m.policial_classe || '',
		m.policial_lotacao || m.seccional,
		...colunasPresencaRelatorio(gise.data_inicio, dataSaidaEfetiva, m.presencaData)
	]);

	const lastAutoY = tabelaPresencasRelatorio(doc, y, tableData);

	const cidade =
		gise.seccionais
			.find((s) => s.seccional_id === seccionalId)
			?.seccional_nome.split('-')[1]
			?.trim() || 'Iguatu';
	const sigY = assinaturaRelatorioExtra(doc, lastAutoY, {
		localData: `${cidade}/CE, ${formatarData(gise.data_inicio)}.`,
		reportSignature,
		matriculaTexto: `${reportSignature?.assinante_matricula ?? '—'}`,
		isPreparando,
		qrCodeBase64,
		baseUrl
	});

	const pdfFinal = await embutirLogosGise(
		new Uint8Array(doc.output('arraybuffer')),
		logoEsqBytes,
		logoDirBytes
	);
	return { pdf: pdfFinal, finalY: sigY };
}

// ---- PDF Relatório Extraordinário GISE (Supervisão) ----
export async function gerarRelatorioExtraordinarioSupervisaoPdf(
	gise: import('$lib/db').GiseDetalhado,
	presencas: GisePresenca[],
	baseUrl?: string,
	reportSignature?: RelatorioAssinatura | null,
	qrCodeBase64?: string,
	isPreparando = false,
	breveEnv?: BreveRelatorioEnv | null,
	logoEsqBytes?: Uint8Array,
	logoDirBytes?: Uint8Array
): Promise<PdfExportResult> {
	const { doc, y, dataSaidaEfetiva } = iniciarRelatorioExtra({
		linhaUnidade: 'SUPERVISÃO GISE — QUADRO DE SUPERVISÃO',
		titulo: 'RELATÓRIO DE SERVIÇO EXTRAORDINÁRIO (SUPERVISÃO)',
		data_inicio: gise.data_inicio,
		hora_entrada: gise.hora_entrada,
		hora_saida: gise.hora_saida,
		breveTitulo: resolveBreveRelatorioTitulo(gise, breveEnv),
		breveConteudo: resolveBreveRelatorioConteudoSupervisao(gise, breveEnv)
	});
	const margin = REL_EXTRA_MARGIN;

	const slots: Array<{
		policial_id: number;
		nome: string;
		cargo: string;
		matricula: string;
		classe: string;
		lotacao: string;
	}> = [];

	const pushSlot = (
		id: number | null | undefined,
		nome: string | null | undefined,
		matricula: string | null | undefined,
		cargo: string,
		lotacao: string
	) => {
		if (id == null || !nome) return;
		const pres = presencas.find((p) => p.policial_id === id);
		slots.push({
			policial_id: id,
			nome,
			cargo,
			matricula: matricula ?? '',
			classe: (pres?.policial_classe as string) || '',
			lotacao: (pres?.policial_lotacao as string) || lotacao
		});
	};

	pushSlot(
		gise.supervisor_id,
		gise.supervisor_nome,
		gise.supervisor_matricula,
		'DPC',
		'Supervisão GISE'
	);
	pushSlot(gise.assessor_id, gise.assessor_nome, gise.assessor_matricula, 'OIP', 'Supervisão GISE');
	pushSlot(
		gise.seint1_id,
		gise.seint1_nome,
		gise.seint1_matricula,
		'OIP',
		'Supervisão GISE — SEINT'
	);
	pushSlot(
		gise.seint2_id,
		gise.seint2_nome,
		gise.seint2_matricula,
		'OIP',
		'Supervisão GISE — SEINT'
	);

	const tableData: LinhaRelatorio[] = slots.map((m) => {
		const pres = presencas.find((p) => p.policial_id === m.policial_id);
		return [
			m.nome,
			m.cargo,
			m.matricula,
			m.classe || '',
			m.lotacao,
			...colunasPresencaRelatorio(gise.data_inicio, dataSaidaEfetiva, pres)
		];
	});

	if (tableData.length === 0) {
		doc.setFontSize(10);
		doc.text('Nenhum integrante definido no quadro de supervisão.', margin, y);
		const pdfVazio = await embutirLogosGise(
			new Uint8Array(doc.output('arraybuffer')),
			logoEsqBytes,
			logoDirBytes
		);
		return { pdf: pdfVazio, finalY: y + 10 };
	}

	const lastAutoY = tabelaPresencasRelatorio(doc, y, tableData);

	const matRelSup =
		(reportSignature?.assinante_matricula && String(reportSignature.assinante_matricula).trim()) ||
		(gise.supervisor_matricula && String(gise.supervisor_matricula).trim()) ||
		'—';
	const sigY = assinaturaRelatorioExtra(doc, lastAutoY, {
		localData: `Fortaleza/CE, ${formatarData(gise.data_inicio)}.`,
		reportSignature,
		matriculaTexto: matRelSup,
		isPreparando,
		qrCodeBase64,
		baseUrl
	});

	const pdfFinal = await embutirLogosGise(
		new Uint8Array(doc.output('arraybuffer')),
		logoEsqBytes,
		logoDirBytes
	);
	return { pdf: pdfFinal, finalY: sigY };
}

/**
 * Escolhe entre `gerarRelatorioExtraordinarioSupervisaoPdf` e
 * `gerarRelatorioExtraordinarioPdf` conforme `isSupExtra`, e NOMEIA os
 * parâmetros que as duas funções tomam posicionalmente.
 *
 * Existe porque as três rotas de download (`gise/[id]/download`, duas vezes,
 * e `validar/[hash]/download`) montavam esse `? :` de 9 argumentos cada —
 * `undefined, false` ao lado um do outro, sem nome, é exatamente onde trocar
 * a ordem não dá erro de tipo nenhum, só resultado errado. `qrCodeBase64`
 * nunca variou nas três cópias (sempre `undefined` — o rodapé com QR é
 * aplicado DEPOIS, por quem chama), por isso não virou parâmetro aqui.
 *
 * `presencas`, `brEnv` e `isSupExtra` continuam responsabilidade de quem
 * chama: são leituras do D1 que o helper não deveria disparar por conta
 * própria — a rota já as tem em mãos ao decidir gerar o PDF.
 */
export async function gerarPdfRelatorioExtraordinario(opts: {
	isSupExtra: boolean;
	gise: import('$lib/db').GiseDetalhado;
	presencas: GisePresenca[];
	seccionalId?: number;
	baseUrl?: string;
	brEnv?: BreveRelatorioEnv | null;
	logoEsqBytes?: Uint8Array;
	logoDirBytes?: Uint8Array;
	reportSignature?: RelatorioAssinatura | null;
	isPreparando?: boolean;
}): Promise<PdfExportResult> {
	const {
		isSupExtra,
		gise,
		presencas,
		seccionalId,
		baseUrl,
		brEnv,
		logoEsqBytes,
		logoDirBytes,
		reportSignature,
		isPreparando = false
	} = opts;

	return isSupExtra
		? gerarRelatorioExtraordinarioSupervisaoPdf(
				gise,
				presencas,
				baseUrl,
				reportSignature,
				undefined,
				isPreparando,
				brEnv,
				logoEsqBytes,
				logoDirBytes
			)
		: gerarRelatorioExtraordinarioPdf(
				toGisePdfData(gise, brEnv),
				presencas,
				seccionalId,
				baseUrl,
				reportSignature,
				undefined,
				isPreparando,
				logoEsqBytes,
				logoDirBytes
			);
}
