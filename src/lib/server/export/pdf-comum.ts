/**
 * Moldura compartilhada dos PDFs: os tipos da escala GISE, o par de logos do
 * topo e o reconhecimento de formato de imagem.
 *
 * Existe porque `pdf.ts` e `pdf-relatorio-extra.ts` desenham o MESMO documento
 * institucional em variantes diferentes — mesma geometria de logo, mesma forma
 * de dados vinda do banco. Sem este arquivo, o relatório extraordinário teria
 * de importar internos de `pdf.ts`, e o `export *` do índice republicaria tipos
 * privados como se fossem API.
 *
 * As medidas em milímetro e a razão de A4 PAISAGEM estão no cabeçalho de
 * `pdf.ts`, que continua sendo a referência das convenções.
 */
import { jsPDF } from 'jspdf';
import { PDFDocument } from 'pdf-lib';

// Type augmentation for jspdf-autotable's lastAutoTable property
export interface JsPDFWithAutoTable extends jsPDF {
	lastAutoTable?: { finalY: number };
}

export interface PdfExportResult {
	pdf: Uint8Array;
	finalY: number;
	pageHeightMm?: number;
}

export interface GisePdfData {
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
				} | null;
			}>;
		}>;
	}>;
	documento: { verificacao_hash?: string | null } | null;
}

export type GisePresenca = {
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
	entrada_selfie_key: string | null;
	saida_timestamp: string | null;
	saida_selfie_key: string | null;
	ip_address: string | null;
	user_agent: string | null;
	latitude: number | null;
	longitude: number | null;
};

/** Subset of the DB row used by PDF generation functions. Compatible with both the
 *  full DB record from buscarAssinaturaRelatorioGise and the partial mock objects
 *  used in assinar/preparar-assinatura routes. */
export type RelatorioAssinatura = {
	assinante_nome?: string | null;
	assinante_matricula?: string | null;
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

export interface GiseProdutividadeData {
	gise: { data_inicio: string };
	seccional: GiseSeccionalParaPdf;
	supervisorDoc?: unknown;
	baseUrl?: string;
	respostas?: RespostaProdutividade[];
}

/** Geometria do par de logos no topo da página, em milímetros. */
export interface GeometriaLogos {
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
export const LOGOS_EXPEDIENTE: GeometriaLogos = {
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
export async function embutirLogosNoTopo(
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
export async function embutirLogosGise(
	pdfBytes: Uint8Array,
	logoEsqBytes?: Uint8Array,
	logoDirBytes?: Uint8Array
): Promise<Uint8Array> {
	return embutirLogosNoTopo(pdfBytes, logoEsqBytes, logoDirBytes, LOGOS_GISE);
}
