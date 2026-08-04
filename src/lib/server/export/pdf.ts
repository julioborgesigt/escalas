/**
 * Geração dos PDFs do sistema — os documentos que o policial assina e que
 * circulam fora dele. São seis, todos aqui porque compartilham a mesma moldura
 * e as mesmas medidas:
 *
 *   escala de FDS · expediente · plantão mensal · escala GISE ·
 *   relatório de produtividade GISE · relatório de serviço extraordinário
 *   (em duas variantes: por seccional e do quadro de supervisão)
 *
 * **A saída é congelada por goldens** (`__tests__/pdf-goldens.test.ts`).
 * Qualquer mudança visual quebra o teste — o que é o comportamento desejado.
 * Ao mudar de propósito, confira o PDF gerado e regrave com
 * `UPDATE_PDF_GOLDENS=1`. Nunca regrave para "fazer o teste passar": estes
 * arquivos são prova documental, e uma alteração silenciosa de layout muda um
 * documento que alguém já assinou em papel.
 *
 * Convenções que valem para o arquivo inteiro:
 *
 * - unidade é MILÍMETRO e o formato é A4 PAISAGEM (297 × 210) nas escalas — as
 *   tabelas têm sete a nove colunas e não cabem em retrato. Daí as constantes
 *   `297` e a margem de 10 mm repetidas nos cálculos de posição;
 * - `PdfExportResult.finalY` é a coordenada onde termina o conteúdo e onde
 *   entra o carimbo visual da assinatura. Quem assina não remede o documento:
 *   ancora por este valor;
 * - antes de desenhar o bloco de assinatura, verifica-se se ele ainda cabe na
 *   página (`sigY > 173` nas escalas); se não couber, abre-se página nova. Uma
 *   assinatura espremida contra o rodapé de identidade/QR não é aceitável num
 *   documento oficial;
 * - texto vindo do banco é sempre normalizado (maiúsculas, data por extenso,
 *   hora `HH:MM`) — a praxe da corporação é o documento sair uniforme,
 *   independentemente de como foi digitado.
 */
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { PDFDocument } from 'pdf-lib';
import type { Escala, EscalaPolicialComDados } from '../../types';
import {
	formatarData,
	formatarDataExtenso,
	calcularDataSaida,
	dataHoraBrasilia,
	MESES_PT
} from '../../utils/datas';
import type { BreveRelatorioEnv } from '$lib/gise/breve-relatorio';
import {
	resolveBreveRelatorioConteudoSeccional,
	resolveBreveRelatorioConteudoSupervisao,
	resolveBreveRelatorioTitulo
} from '$lib/gise/breve-relatorio';
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
	formatarMesAno,
	cabecalhoDelegacia
} from './shared';
import { CORPORACAO, DELEGACIA_GERAL, DEPARTAMENTO } from '$lib/institucional';

// Type augmentation for jspdf-autotable's lastAutoTable property
interface JsPDFWithAutoTable extends jsPDF {
	lastAutoTable?: { finalY: number };
}

interface PdfExportResult {
	pdf: Uint8Array;
	finalY: number;
	pageHeightMm?: number;
}

interface GisePdfData {
	data_inicio: string;
	hora_entrada: string;
	hora_saida: string;
	status: string;
	/** Rótulo e parágrafo do bloco "Breve relatório" (já resolvidos: GISE + env + padrão). */
	breve_relatorio_titulo: string;
	breve_relatorio_conteudo: string;
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
				presenca?: {
					entrada_timestamp?: string | null;
					saida_timestamp?: string | null;
					entrada_rubrica?: string | null;
					saida_rubrica?: string | null;
				} | null;
			}>;
		}>;
	}>;
	documento: { rubrica?: string | null; verificacao_hash?: string | null } | null;
}

type GisePresenca = {
	id: number;
	gise_id: number;
	policial_id: number | null;
	policial_nome: string | null;
	policial_matricula: string | null;
	policial_cpf: string | null;
	policial_cargo: string | null;
	policial_classe: string | null;
	policial_lotacao: string | null;
	entrada_timestamp: string | null;
	entrada_rubrica: string | null;
	entrada_selfie_key: string | null;
	saida_timestamp: string | null;
	saida_rubrica: string | null;
	saida_selfie_key: string | null;
	ip_address: string | null;
	user_agent: string | null;
	latitude: number | null;
	longitude: number | null;
};

/** Subset of the DB row used by PDF generation functions. Compatible with both the
 *  full DB record from buscarAssinaturaRelatorioGise and the partial mock objects
 *  used in assinar/preparar-assinatura routes. */
type RelatorioAssinatura = {
	assinante_nome?: string | null;
	assinante_matricula?: string | null;
	rubrica?: string | null;
	verification_hash?: string | null;
	created_at?: string | null;
};

type GiseSeccionalEquipe = { id: number; tipo: string; [key: string]: unknown };
type GiseSeccionalParaPdf = {
	id?: number;
	seccional_id?: number;
	seccional_nome?: string;
	nome?: string;
	equipes?: GiseSeccionalEquipe[];
	unidades?: Array<{ equipes?: GiseSeccionalEquipe[] }>;
	[key: string]: unknown;
};
type RespostaProdutividade = { equipe_id: number; pergunta: string; resposta: string };

interface GiseProdutividadeData {
	gise: { data_inicio: string };
	seccional: GiseSeccionalParaPdf;
	supervisorDoc?: unknown;
	baseUrl?: string;
	respostas?: RespostaProdutividade[];
}

function fmtHoraGise(h: string | number | null | undefined): string {
	if (!h) return '';
	if (String(h).includes(':')) return String(h);
	const n = parseInt(String(h));
	if (isNaN(n)) return String(h);
	return `${String(n).padStart(2, '0')}:00`;
}

function getImgFormat(dataUrl: string): string | undefined {
	if (!dataUrl || typeof dataUrl !== 'string') return undefined;
	if (dataUrl.includes('image/png')) return 'PNG';
	if (dataUrl.includes('image/jpeg') || dataUrl.includes('image/jpg')) return 'JPEG';
	if (dataUrl.includes('image/webp')) return 'WEBP';
	return undefined;
}

/**
 * Desenha a rubrica do signatário centralizada logo ACIMA da linha de assinatura
 * (em `sigY`), preservando o aspecto natural. Usado nas escalas para a CÓPIA DE
 * CONFERÊNCIA — assim o documento impresso mostra a mesma rubrica que o PDF
 * digital assinado por token, em vez do campo vazio. Best-effort: nunca lança.
 */
function desenharRubricaSobreLinha(
	doc: jsPDF,
	rubrica: string,
	sigCenterX: number,
	sigY: number
): void {
	try {
		const format = getImgFormat(rubrica);
		const props = doc.getImageProperties(rubrica);
		const ratio = props.width > 0 ? props.height / props.width : 22 / 60;
		let rubW = 60;
		let rubH = rubW * ratio;
		const maxH = 24;
		if (rubH > maxH) {
			rubH = maxH;
			rubW = ratio > 0 ? rubH / ratio : 60;
		}
		doc.addImage(rubrica, format || 'PNG', sigCenterX - rubW / 2, sigY - 3 - rubH, rubW, rubH);
	} catch (e) {
		console.error('Erro ao inserir rubrica na escala:', e);
	}
}

/**
 * Se o cadastro do policial supervisor estiver sem matrícula, usa a matrícula do usuário da sessão
 * (mesmo id) para o PDF da escala — evita "Matrícula: —" quando o DPC assina.
 */
export function giseDetalhadoComMatriculaSupervisorSessao(
	gise: import('$lib/db').GiseDetalhado,
	u: { tipo: 'policial' | 'admin'; id: number; matricula?: string }
): import('$lib/db').GiseDetalhado {
	if (u.tipo !== 'policial' || gise.supervisor_id !== u.id) return gise;
	const m = u.matricula?.trim();
	if (!m) return gise;
	if (gise.supervisor_matricula?.trim()) return gise;
	return { ...gise, supervisor_matricula: m };
}

/** Transforma GiseDetalhado (DB) em GisePdfData (estrutura plana com equipes) para geração de PDF. */
export function toGisePdfData(
	gise: import('$lib/db').GiseDetalhado,
	breveEnv?: BreveRelatorioEnv | null
): GisePdfData {
	if (!gise) throw new Error('Dados da GISE não fornecidos');

	return {
		data_inicio: gise.data_inicio || '',
		hora_entrada: gise.hora_entrada || '08:00',
		hora_saida: gise.hora_saida || '16:00',
		status: gise.status || '',
		breve_relatorio_titulo: resolveBreveRelatorioTitulo(gise, breveEnv),
		breve_relatorio_conteudo: resolveBreveRelatorioConteudoSeccional(gise, breveEnv),
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
		seccionais: (gise.seccionais || []).map((sec) => {
			const equipesList: GisePdfData['seccionais'][number]['equipes'] = [];

			(sec.unidades || []).forEach((slot) => {
				(slot.equipes || []).forEach((eq) => {
					equipesList.push({
						tipo: eq.tipo,
						slots_dpc: eq.slots_dpc || 0,
						slots_oip: eq.slots_oip || 0,
						hora_entrada: eq.hora_entrada,
						hora_saida: eq.hora_saida,
						membros: (eq.membros || []).map((m) => ({
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
		documento: gise.documento
			? {
					rubrica: gise.documento.rubrica,
					verificacao_hash: gise.documento.verificacao_hash
				}
			: null
	};
}

// ---- PDF ----
/**
 * PDF da escala de FIM DE SEMANA: uma tabela por DIA, na ordem cronológica.
 *
 * Sem cabeçalho institucional com logos — o FDS é documento operacional de
 * curto prazo, distribuído internamente, ao contrário do expediente e do
 * plantão, que são a escala oficial do mês.
 */
export function gerarPdf(
	escala: Escala,
	policiais: EscalaPolicialComDados[],
	rubrica?: string
): PdfExportResult {
	const dias = agruparPorData(policiais);
	const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

	doc.setFontSize(14);
	doc.text(
		`ESCALA PLANTÃO FINAL DE SEMANA ${escala.lotacao.toUpperCase()} ${formatarData(escala.data_inicio)} ${sepDatas(escala.data_inicio, escala.data_fim)} ${formatarData(escala.data_fim)}`,
		148,
		15,
		{ align: 'center' }
	);

	let y = 25;

	for (const dia of dias) {
		const tableData = dia.policiais.map((p) => [
			p.nome,
			p.matricula,
			p.cargo,
			p.telefone || '',
			p.lotacao,
			formatarDataPlantao(p, escala),
			formatarHorario(p, escala)
		]);

		autoTable(doc, {
			head: [
				['EQUIPE DE PLANTÃO DA DP', 'MATRÍCULA', 'CARGO', 'TELEFONE', 'LOTAÇÃO', 'DATA', 'HORÁRIO']
			],
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
	// Bloco de assinatura mais alto (offset/cap menores): deixa folga entre a
	// assinatura e o rodapé de identidade/QR no pé da página (mesma diretriz do plantão).
	let sigY = lastY + 20;
	if (sigY > 173) {
		doc.addPage();
		sigY = 35;
	}

	return finalizarEscalaComAssinatura(doc, escala, sigY, rubrica);
}

/**
 * Rodapé de assinatura das escalas (FDS e plantão): cidade + data por extenso
 * à esquerda, rubrica opcional sobre a linha de assinatura à direita.
 * Fonte única do bloco que era copiado nos dois geradores.
 */
function finalizarEscalaComAssinatura(
	doc: jsPDF,
	escala: Escala,
	sigY: number,
	rubrica?: string
): PdfExportResult {
	const margin = 10;
	const pageWidth = 297;
	doc.setFontSize(9);
	doc.setFont('helvetica', 'normal');

	const localizacao = escala.cidade && escala.cidade !== escala.lotacao ? escala.cidade : '';
	const dataExtenso = formatarDataExtenso(new Date());
	const textoData = localizacao ? `${localizacao}, ${dataExtenso}` : dataExtenso;
	doc.text(textoData, margin, sigY);

	const sigCenterX = pageWidth * 0.75;
	if (rubrica) desenharRubricaSobreLinha(doc, rubrica, sigCenterX, sigY);
	doc.line(sigCenterX - 45, sigY, sigCenterX + 45, sigY);
	doc.setFontSize(8);
	doc.text('Delegado(a) de Polícia / assinado digitalmente', sigCenterX, sigY + 5, {
		align: 'center'
	});

	return { pdf: new Uint8Array(doc.output('arraybuffer')), finalY: sigY };
}

// ---- PDF Expediente ----
/**
 * PDF da escala de EXPEDIENTE — o documento oficial do mês, com o cabeçalho
 * institucional completo (Polícia Civil → Delegacia Geral → Departamento) e as
 * logos embutidas quando o chamador as fornece.
 *
 * As logos chegam como BYTES por parâmetro, nunca buscadas aqui: a geração roda
 * no Worker e não pode depender de rede nem de R2 no meio do documento.
 *
 * Uma linha por policial, sem datas — expediente não tem dia de plantão. O
 * rodapé de OBSERVAÇÕES é texto FIXO da corporação (o que declarar em férias e
 * licenças) e faz parte do formulário, não é dica de UI.
 */
export async function gerarPdfExpediente(
	escala: Escala,
	policiais: EscalaPolicialComDados[],
	logoPoliciaBytes?: Uint8Array,
	logoCearaBytes?: Uint8Array,
	rubrica?: string
): Promise<PdfExportResult> {
	const PAGE_H = 210; // paisagem A4
	const PAGE_W = 297;
	const margin = 10;
	const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
	const sorted = sortExpediente(policiais);

	let y = 10;
	doc.setFont('helvetica', 'bold');
	doc.setFontSize(9);
	doc.text(CORPORACAO, PAGE_W / 2, y, { align: 'center' });
	y += 4.5;
	doc.setFont('helvetica', 'normal');
	doc.setFontSize(8);
	doc.text(DELEGACIA_GERAL, PAGE_W / 2, y, { align: 'center' });
	y += 4;
	doc.text(DEPARTAMENTO, PAGE_W / 2, y, { align: 'center' });
	y += 7;

	const TEAL: [number, number, number] = [26, 92, 87];
	const WHITE: [number, number, number] = [255, 255, 255];
	const BLACK: [number, number, number] = [0, 0, 0];
	const LIGHT: [number, number, number] = [245, 245, 245];
	const NCOLS = 8;

	const headTeal = {
		fillColor: TEAL,
		textColor: WHITE,
		fontStyle: 'bold' as const,
		halign: 'center' as const
	};
	const headMeta = {
		fillColor: WHITE,
		textColor: BLACK,
		fontStyle: 'bold' as const,
		halign: 'left' as const,
		lineColor: [200, 200, 200] as [number, number, number],
		lineWidth: 0.2
	};

	const obsText =
		'OBSERVAÇÕES: FÉRIAS (INFORMAR PERÍODO DE INÍCIO/FIM); LICENÇAS (INFORMAR PERÍODO DE INÍCIO/FIM E ANEXAR A DOCUMENTAÇÃO RELACIONADA).';

	autoTable(doc, {
		head: [
			[
				{
					content: 'ESCALA DE EXPEDIENTE',
					colSpan: NCOLS,
					styles: { ...headTeal, fontSize: 9, cellPadding: 2.5 }
				}
			],
			[
				{
					content: cabecalhoDelegacia(escala),
					colSpan: NCOLS,
					styles: { ...headMeta, fontSize: 8, cellPadding: 1.5 }
				}
			],
			[
				{
					content: `MÊS/ANO: ${formatarMesAno(escala.data_inicio)}`,
					colSpan: NCOLS,
					styles: { ...headMeta, fontSize: 8, cellPadding: 1.5 }
				}
			],
			COLS_EXPEDIENTE.map((c) => ({
				content: c,
				styles: { ...headTeal, fontSize: 7, cellPadding: 1.5 }
			}))
		],
		body: [
			...sorted.map((p) => rowExpediente(p)),
			[
				{
					content: obsText,
					colSpan: NCOLS,
					styles: {
						fontStyle: 'bold' as const,
						fontSize: 7,
						fillColor: LIGHT,
						textColor: BLACK,
						cellPadding: 2
					}
				}
			]
		],
		startY: y,
		theme: 'grid',
		headStyles: {
			fillColor: TEAL,
			textColor: WHITE,
			fontStyle: 'bold',
			fontSize: 7,
			halign: 'center'
		},
		bodyStyles: { fontSize: 7, valign: 'middle', halign: 'left' },
		columnStyles: {
			0: { cellWidth: 60 },
			1: { cellWidth: 24, halign: 'center' },
			2: { cellWidth: 14, halign: 'center' },
			3: { cellWidth: 28, halign: 'center' },
			4: { cellWidth: 16, halign: 'center' },
			5: { cellWidth: 30 },
			6: { cellWidth: 22, halign: 'center' },
			7: { cellWidth: 'auto' }
		},
		margin: { left: margin, right: margin }
	});

	const lastY = (doc as JsPDFWithAutoTable).lastAutoTable?.finalY ?? y;
	let sigY = lastY + 12;
	if (sigY > 183) {
		doc.addPage();
		sigY = 35;
	}

	const localizacao = escala.cidade && escala.cidade !== escala.lotacao ? escala.cidade : '';
	const dataExtenso = formatarDataExtenso(new Date());
	const textoData = localizacao ? `${localizacao}, ${dataExtenso}` : dataExtenso;

	doc.setFontSize(9);
	doc.setFont('helvetica', 'bold');
	doc.text(textoData, margin, sigY);

	sigY += 22;
	const sigCenterX = PAGE_W * 0.75;
	if (rubrica) desenharRubricaSobreLinha(doc, rubrica, sigCenterX, sigY);
	doc.line(sigCenterX - 45, sigY, sigCenterX + 45, sigY);
	doc.setFontSize(8);
	doc.setFont('helvetica', 'normal');
	doc.text('Delegado(a) de Polícia / assinado digitalmente', sigCenterX, sigY + 5, {
		align: 'center'
	});

	const pdfBytes = new Uint8Array(doc.output('arraybuffer'));
	const comLogos = await embutirLogosNoTopo(
		pdfBytes,
		logoPoliciaBytes,
		logoCearaBytes,
		LOGOS_EXPEDIENTE
	);
	return { pdf: comLogos, finalY: sigY, pageHeightMm: PAGE_H };
}

// ---- PDF Plantão ----
/**
 * PDF da escala de PLANTÃO mensal, agrupada por EQUIPE — é assim que a escala é
 * lida no plantão: primeiro qual equipe, depois quem está nela e em que dias.
 *
 * Cada equipe vira uma tabela própria; policial sem equipe cai num grupo
 * genérico "EQUIPE" em vez de sumir do documento.
 */
export function gerarPdfPlantao(
	escala: Escala,
	policiais: EscalaPolicialComDados[],
	rubrica?: string
): PdfExportResult {
	const equipes = agruparPlantao(policiais);
	const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
	const pageWidth = 297;
	const margin = 10;

	let y = 12;
	doc.setFontSize(10);
	doc.setFont('helvetica', 'bold');
	doc.text(CORPORACAO, pageWidth / 2, y, { align: 'center' });
	y += 5;
	doc.setFontSize(8);
	doc.setFont('helvetica', 'normal');
	// Única das seis escalas que junta Delegacia Geral e Departamento numa linha
	// só — o cabeçalho do plantão mensal é mais compacto que o do expediente.
	doc.text(`${DELEGACIA_GERAL} / ${DEPARTAMENTO}`, pageWidth / 2, y, { align: 'center' });
	y += 5;
	doc.setFont('helvetica', 'bold');
	doc.text(cabecalhoDelegacia(escala), margin, y);
	y += 5;
	doc.text(`MÊS/ANO: ${formatarMesAno(escala.data_inicio)}`, margin, y);
	y += 8;

	for (const [equipe, oficiais] of equipes) {
		const equipeLabel = equipe ? `EQUIPE ${equipe}` : 'EQUIPE';
		const rows = oficiais.map((o) => rowPlantao(o));

		autoTable(doc, {
			head: [
				[
					{
						content: equipeLabel,
						colSpan: 7,
						styles: {
							halign: 'center',
							fillColor: [26, 92, 87],
							textColor: [255, 255, 255],
							fontStyle: 'bold',
							fontSize: 8
						}
					}
				],
				[...COLS_PLANTAO]
			],
			body: rows,
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
				4: { cellWidth: 38 },
				5: { cellWidth: 55, halign: 'center' },
				6: { cellWidth: 'auto' }
			},
			margin: { left: margin, right: margin }
		});

		y = ((doc as JsPDFWithAutoTable).lastAutoTable?.finalY ?? y) + 6;
	}

	const lastY = (doc as JsPDFWithAutoTable).lastAutoTable?.finalY ?? y;

	// Observação logo abaixo do fim da tabela (não colada à assinatura).
	doc.setFontSize(8);
	doc.setFont('helvetica', 'normal');
	doc.text('Obs.: Escala sujeita a alteração conforme necessidade do serviço.', margin, lastY + 8);

	// Bloco de assinatura mais alto (offset menor): sobe a data/linha/rubrica,
	// deixando folga entre a assinatura e o rodapé de identidade/QR no pé da página.
	let sigY = lastY + 28;
	if (sigY > 178) {
		doc.addPage();
		sigY = 35;
	}

	return finalizarEscalaComAssinatura(doc, escala, sigY, rubrica);
}

// ---- PDF GISE ----
/**
 * PDF da ESCALA GISE — a estrutura completa do serviço: quadro de supervisão,
 * cada seccional com suas unidades, equipes e membros.
 *
 * É o mais longo dos documentos e o único hierárquico, então é aqui que a
 * paginação exige cuidado: antes de cada seccional e de cada equipe verifica-se
 * `y > 175` e, se for o caso, abre-se página — assim um título nunca fica
 * sozinho no pé da folha, separado da sua tabela.
 *
 * Seccional cujas equipes estejam TODAS vazias é omitida por inteiro. Mostrar
 * "(sem membros alocados)" enchia o documento de blocos sem informação; foi
 * pedido dos operadores.
 *
 * O horário de cada equipe segue a mesma cadeia da tela — equipe > seccional >
 * escala — para o papel não divergir do sistema.
 *
 * Presenças aparecem como RUBRICA desenhada sobre a linha, não como texto
 * "assinado": o documento tem de exibir a marca de quem confirmou entrada e
 * saída.
 */
export async function gerarPdfGise(
	gise: GisePdfData,
	logoJpgBytes?: Uint8Array,
	logoCearaBytes?: Uint8Array
): Promise<PdfExportResult> {
	const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
	const pageWidth = 297;

	doc.setFontSize(14);
	doc.setFont('helvetica', 'bold');
	doc.text(`Escala GISE SUL para o dia ${formatarData(gise.data_inicio)}`, pageWidth / 2, 14, {
		align: 'center'
	});

	let y = 26;

	for (const sec of gise.seccionais) {
		// Pula seccionais cujas equipes estejam todas vazias — caso contrário
		// o PDF mostra cabeçalho + tabela "(sem membros alocados)" sem valor
		// informativo. Operadores pediram para omitir totalmente.
		const equipesComMembros = sec.equipes.filter((e) => e.membros.length > 0);
		if (equipesComMembros.length === 0) continue;

		if (y > 175) {
			doc.addPage();
			y = 15;
		}

		doc.setFontSize(11);
		doc.setFont('helvetica', 'bold');
		const secHora = sec.hora_entrada ? ` (H. ${sec.hora_entrada}-${sec.hora_saida})` : '';
		doc.text(`${sec.seccional_nome}${secHora}`, 10, y);
		y += 4;

		for (const equipe of equipesComMembros) {
			if (y > 175) {
				doc.addPage();
				y = 15;
			}

			const hEnt = equipe.hora_entrada || sec.hora_entrada || gise.hora_entrada;
			const hSai = equipe.hora_saida || sec.hora_saida || gise.hora_saida;

			const titleLabel =
				equipe.tipo === 'operacional'
					? `Equipe Operacional - ${sec.unidade_operacional_nome ?? '—'}`
					: `Equipe SEINT`;

			const tableData = equipe.membros.map((m) => [
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

			autoTable(doc, {
				head: [
					[{ content: titleLabel, colSpan: 9, styles: { halign: 'center' } }],
					[
						'Nome',
						'Cargo',
						'Matrícula',
						'Telefone',
						'Lotação',
						'Data de Início',
						'Hora de Início',
						'Data de Término',
						'Hora de Término'
					]
				],
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

	const lastY = (doc as JsPDFWithAutoTable).lastAutoTable?.finalY ?? y;
	let sigY = lastY + 40;
	if (sigY > 185) {
		doc.addPage();
		sigY = 35;
	}

	const sigCenterX = pageWidth * 0.75;
	const docData = gise.documento;

	if (docData?.rubrica) desenharRubricaSobreLinha(doc, docData.rubrica, sigCenterX, sigY);

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
	}

	doc.line(sigCenterX - 45, sigY, sigCenterX + 45, sigY);
	doc.setFontSize(8);
	doc.setFont('helvetica', 'bold');
	doc.text((gise.supervisor_nome || 'Supervisão do GISE').toUpperCase(), sigCenterX, sigY + 4, {
		align: 'center'
	});
	doc.setFont('helvetica', 'normal');
	const matSup = (gise.supervisor_matricula && String(gise.supervisor_matricula).trim()) || '—';
	doc.text(`Matrícula: ${matSup}`, sigCenterX, sigY + 8, { align: 'center' });
	doc.text('Delegado(a) de Polícia / assinado digitalmente', sigCenterX, sigY + 12, {
		align: 'center'
	});

	const pdfBytes = new Uint8Array(doc.output('arraybuffer'));
	const withLogos = await embutirLogosGise(pdfBytes, logoJpgBytes, logoCearaBytes);
	return { pdf: withLogos, finalY: sigY };
}

/** Geometria do par de logos no topo da página, em milímetros. */
interface GeometriaLogos {
	larguraMm: number;
	alturaMm: number;
	/** Do topo da página até o topo do logo. */
	topoMm: number;
	/** Margem lateral — ancora o logo esquerdo e, espelhada, o direito. */
	margemMm: number;
	/** Largura da página, para ancorar o logo direito pela borda. */
	paginaMm: number;
}

/**
 * As duas geometrias em uso, e elas NÃO são iguais.
 *
 * O expediente usa 42mm a 3mm do topo; o GISE e os relatórios extraordinários,
 * 45mm a 5mm. A diferença é anterior a esta extração e nunca teve justificativa
 * registrada — pode ser ajuste deliberado ao cabeçalho de cada documento ou
 * pode ser cópia que derivou. Uniformizar mudaria a aparência de documentos
 * oficiais, então é decisão do operador, não de refatoração: até lá, ficam
 * explícitas lado a lado em vez de escondidas em dois blocos distantes.
 */
const LOGOS_EXPEDIENTE: GeometriaLogos = {
	larguraMm: 42,
	alturaMm: 14,
	topoMm: 3,
	margemMm: 10,
	paginaMm: 297
};
const LOGOS_GISE: GeometriaLogos = {
	larguraMm: 45,
	alturaMm: 14,
	topoMm: 5,
	margemMm: 10,
	paginaMm: 297
};

/**
 * Embute o par de logos institucionais em TODAS as páginas de um PDF já gerado:
 * um no canto superior esquerdo, outro no direito.
 *
 * Roda como segundo passo, sobre os bytes que o jsPDF produziu, porque o jsPDF
 * não embute JPEG com a fidelidade que o pdf-lib embute — daí o `PDFDocument.load`
 * de um PDF recém-serializado.
 *
 * BEST-EFFORT em três níveis, e é isso que a extração protege: logo ausente é
 * pulado, logo que falha no embed vira `null` e é pulado, e qualquer erro no
 * caminho todo devolve o PDF ORIGINAL. Uma escala tem de sair mesmo sem timbre;
 * o que não pode é o servidor devolver erro por causa de uma imagem.
 */
async function embutirLogosNoTopo(
	pdfBytes: Uint8Array,
	logoEsqBytes: Uint8Array | undefined,
	logoDirBytes: Uint8Array | undefined,
	geo: GeometriaLogos
): Promise<Uint8Array> {
	const temEsq = !!(logoEsqBytes && logoEsqBytes.length > 0);
	const temDir = !!(logoDirBytes && logoDirBytes.length > 0);
	if (!temEsq && !temDir) return pdfBytes;

	try {
		const pdfDoc = await PDFDocument.load(pdfBytes);
		const mmToPt = 2.83465;
		const imgEsq = temEsq ? await pdfDoc.embedJpg(logoEsqBytes!).catch(() => null) : null;
		const imgDir = temDir ? await pdfDoc.embedJpg(logoDirBytes!).catch(() => null) : null;

		const largura = geo.larguraMm * mmToPt;
		const altura = geo.alturaMm * mmToPt;
		for (const page of pdfDoc.getPages()) {
			const { height } = page.getSize();
			// A origem do pdf-lib fica embaixo; a medida do documento é a partir
			// do topo, então a conversão passa pela altura REAL desta página.
			const y = height - (geo.topoMm + geo.alturaMm) * mmToPt;
			if (imgEsq) {
				page.drawImage(imgEsq, { x: geo.margemMm * mmToPt, y, width: largura, height: altura });
			}
			if (imgDir) {
				const x = (geo.paginaMm - geo.margemMm - geo.larguraMm) * mmToPt;
				page.drawImage(imgDir, { x, y, width: largura, height: altura });
			}
		}

		return await pdfDoc.save();
	} catch (e: unknown) {
		console.error('Erro ao inserir logos com pdf-lib:', e instanceof Error ? e.message : e);
		return pdfBytes;
	}
}

/** `logogise` à esquerda e `logo_ceara` à direita — PDF GISE e relatórios extraordinários. */
async function embutirLogosGise(
	pdfBytes: Uint8Array,
	logoEsqBytes?: Uint8Array,
	logoDirBytes?: Uint8Array
): Promise<Uint8Array> {
	return embutirLogosNoTopo(pdfBytes, logoEsqBytes, logoDirBytes, LOGOS_GISE);
}

// ---- PDF Relatório de Produtividade GISE ----
/**
 * PDF do RELATÓRIO DE PRODUTIVIDADE de uma seccional na GISE — as respostas do
 * formulário, já achatadas em `(pergunta, resposta)` por
 * `buscarRespostasProdutividadeSeccional`.
 *
 * A ordem das perguntas é a do MODELO, não a do blob: modelo editado muda o
 * relatório sem mexer aqui. Pergunta sem resposta não aparece — o relatório
 * mostra o que foi feito.
 */
export function gerarRelatorioProdutividadeGisePdf(data: GiseProdutividadeData) {
	const { gise, seccional, respostas = [] } = data;
	const doc = new jsPDF('p', 'mm', 'a4');
	const margin = 15;
	const pageWidth = doc.internal.pageSize.getWidth();
	let y = 20;

	doc.setFont('helvetica', 'bold');
	doc.setFontSize(14);
	doc.text(CORPORACAO, pageWidth / 2, y, { align: 'center' });
	y += 7;
	doc.setFontSize(12);
	doc.text(DEPARTAMENTO, pageWidth / 2, y, { align: 'center' });
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
			const teamResponses = respostas.filter((r) => r.equipe_id === team.id);
			if (teamResponses.length === 0) continue;

			doc.setFont('helvetica', 'bold');
			doc.setFillColor(245, 245, 245);
			doc.rect(margin, y, pageWidth - 2 * margin, 8, 'F');
			doc.text(
				`EQUIPE: ${team.tipo === 'operacional' ? 'OPERACIONAL' : 'SEINT'}`,
				margin + 2,
				y + 6
			);
			y += 12;

			const rows = teamResponses.map((r) => [r.pergunta, r.resposta]);

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
	const dataExtenso = `${now.getDate()} de ${MESES_PT[now.getMonth()]} de ${now.getFullYear()}`;
	doc.setFontSize(10);
	doc.setFont('helvetica', 'normal');
	doc.text(`Gerado em: ${dataExtenso}`, margin, doc.internal.pageSize.getHeight() - 10);

	return { pdf: new Uint8Array(doc.output('arraybuffer')), finalY: y };
}

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
