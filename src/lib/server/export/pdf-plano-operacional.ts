/**
 * PDF do PLANO OPERACIONAL — o documento da operação com deslocamento.
 *
 * Três páginas, na estrutura do modelo fornecido pela corporação:
 *
 *   1. **corpo** — oito seções numeradas, do FINALIDADE ao COORDENADOR, com o
 *      fecho e o bloco de assinatura do Diretor Titular;
 *   2. **ANEXO I** — as equipes, cada uma com viatura, destino, briefing e a
 *      linha de cada servidor com o custo dele;
 *   3. **ANEXO II** — o consolidado financeiro por categoria.
 *
 * ## Moldura própria, e por quê
 *
 * Nada aqui é usado por escala nenhuma — é o mesmo critério que separou
 * `pdf-relatorio-extra.ts` de `pdf.ts`. O que se reaproveita é o timbre
 * (`$lib/institucional`) e o par de logos (`pdf-comum`), não a diagramação: o
 * plano é RETRATO e as escalas são paisagem, porque aqui o conteúdo é texto
 * corrido e lá são tabelas de nove colunas.
 *
 * ## A saída é congelada por goldens
 *
 * `__tests__/pdf-goldens.test.ts` compara o SHA-256 byte a byte. Vale a mesma
 * regra dos outros documentos: **nunca regrave para "fazer o teste passar"**.
 * Mudança visual intencional se confere no PDF gerado e só então se regrava com
 * `UPDATE_PDF_GOLDENS=1`.
 *
 * Consequência prática: nada aqui pode ser não-determinístico. A data de
 * emissão entra por PARÂMETRO (`emitidoEm`), não de `new Date()` — senão o
 * golden mudaria a cada meia-noite.
 *
 * ## Os números não são calculados aqui
 *
 * `custoDoPlano` já rodou no servidor e o resultado chega pronto. É a mesma
 * chamada que alimenta o painel da tela: recalcular aqui abriria a porta para o
 * documento imprimir um total diferente do que o Admin Geral conferiu.
 */
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
	CORPORACAO,
	DELEGACIA_GERAL,
	DEPARTAMENTO,
	DEPARTAMENTO_PROSA,
	DPI_SUL_ENDERECO,
	DPI_SUL_EMAIL,
	CIDADE_EMISSAO
} from '../../institucional';
import { formatarData, formatarDataExtenso, diaSemanaExtenso } from '../../utils/datas';
import { REFERENCIAS_PADRAO } from '../../planos/padroes';
import {
	formatarBRL,
	resumoHoras,
	rotuloCustoDaEquipe,
	TITULO_DRO,
	TITULO_DIARIAS
} from '../../planos/rotulos';
import { formatarDiarias } from '../../planos/meias-diarias';
import { ROTULO_CATEGORIA } from '../../planos/faixa-custo';
import type { CustoPlano } from '../../planos/custo';
import { embutirLogosNoTopo, type JsPDFWithAutoTable, type PdfExportResult } from './pdf-comum';

// A4 RETRATO. As escalas são paisagem por causa das tabelas largas; aqui o
// conteúdo é texto corrido em seções, e retrato é o formato do modelo.
const PAGINA_L = 210;
const PAGINA_A = 297;
const MARGEM = 20;
const UTIL = PAGINA_L - MARGEM * 2;

/** Geometria dos logos no topo, na proporção do retrato. */
const LOGOS_PLANO = {
	larguraMm: 35,
	alturaMm: 12,
	topoMm: 8,
	margemMm: MARGEM,
	paginaMm: PAGINA_L
};

/**
 * Uma equipe como o Anexo I a imprime.
 *
 * Não é exportada: quem monta o documento é a rota de download, que constrói
 * estes objetos inline a partir das linhas do banco. Publicar o nome sem
 * consumidor é superfície que envelhece — se um dia outro gerador precisar da
 * forma, ela sobe junto com o call site.
 */
interface EquipePdf {
	id: number;
	nome: string;
	tipo: 'operacional' | 'seint';
	viatura_modelo: string;
	viatura_placa: string;
	cidade_destino: string;
	tipo_custo: 'sem_custo' | 'hora_extra' | 'diaria';
	horas_normais: number;
	horas_plus: number;
	diaria_tipo: 'estadual' | 'interestadual' | null;
	diarias_meias: number;
	/** Já resolvidos pela cascata equipe → plano no servidor. */
	horaApresentacao: string;
	briefing: string;
	membros: Array<{
		policial_id: number;
		nome: string;
		matricula: string;
		lotacao: string;
		telefone: string | null;
		cargo_snapshot: string;
		classe_snapshot: string;
		chefe: boolean;
	}>;
}

/** Tudo o que o documento imprime. */
export interface PlanoPdfData {
	numero: number;
	ano: number;
	nome: string;
	finalidade: string;
	/** Uma ação por linha (item 2b). */
	acoes: string;
	nup: string | null;
	data_inicio: string;
	hora_inicio: string;
	departamento: string;
	coordenador: { nome: string; matricula: string; lotacao: string } | null;
	demandante: string | null;
	diretor_nome: string;
	diretor_cargo: string;
	equipes: EquipePdf[];
	custo: CustoPlano;
	/** Versão de valores aplicada — a linha de procedência do Anexo II. */
	versaoValores: { id: number; vigente_desde: string } | null;
	/**
	 * Data de emissão em `YYYY-MM-DD`, para o fecho.
	 *
	 * Parâmetro, e não `new Date()`: o golden compara bytes, e um relógio dentro
	 * do gerador faria o teste quebrar sozinho na virada do dia.
	 */
	emitidoEm: string;
}

/** Rodapé institucional, repetido em todas as páginas. */
function rodape(doc: jsPDF) {
	const total = doc.getNumberOfPages();
	for (let i = 1; i <= total; i++) {
		doc.setPage(i);
		doc.setFontSize(7);
		doc.setFont('helvetica', 'normal');
		doc.setTextColor(90);
		let y = PAGINA_A - 18;
		for (const linha of [DEPARTAMENTO_PROSA, DPI_SUL_ENDERECO, `E-mail: ${DPI_SUL_EMAIL}`]) {
			doc.text(linha, PAGINA_L / 2, y, { align: 'center' });
			y += 3.6;
		}
		doc.setTextColor(0);
	}
}

/** Timbre do topo — a mesma estrutura das outras famílias de PDF do sistema. */
function timbre(doc: jsPDF, y: number): number {
	doc.setFontSize(10);
	doc.setFont('helvetica', 'bold');
	doc.text(CORPORACAO, PAGINA_L / 2, y, { align: 'center' });
	y += 4.5;
	doc.text(DELEGACIA_GERAL, PAGINA_L / 2, y, { align: 'center' });
	y += 4.5;
	doc.setFontSize(9);
	doc.text(DEPARTAMENTO, PAGINA_L / 2, y, { align: 'center' });
	return y + 8;
}

/**
 * Escreve um parágrafo com quebra automática e devolve o `y` final.
 *
 * Abre página nova quando o bloco não cabe — o rodapé ocupa os últimos 22mm, e
 * texto por baixo dele sairia ilegível no papel.
 */
function paragrafo(doc: jsPDF, texto: string, y: number, opts?: { x?: number; largura?: number }) {
	const x = opts?.x ?? MARGEM;
	const largura = opts?.largura ?? UTIL;
	const linhas = doc.splitTextToSize(texto, largura);
	for (const linha of linhas) {
		if (y > PAGINA_A - 26) {
			doc.addPage();
			y = MARGEM;
		}
		doc.text(linha, x, y);
		y += 5;
	}
	return y;
}

/**
 * Espaço entre o fim de uma seção e o título da seguinte.
 *
 * Apertado de propósito. O corpo tem NOVE seções, sete delas de uma linha só
 * ("Conforme anexo I."), e cada milímetro entre elas é multiplicado por nove.
 */
const ENTRE_SECOES = 3;

/** Altura de uma linha de texto — `paragrafo` e as medições usam a mesma. */
const LINHA = 5;

/**
 * Altura do bloco de fecho: 8mm até a data, 18mm de claro para a rubrica, 5mm
 * do nome ao cargo. Usada para DECIDIR a quebra antes de escrever qualquer
 * parte dele — mexer num destes três números sem mexer aqui reintroduz a
 * página órfã.
 */
const ALTURA_FECHO = 31;

/**
 * Última linha que pode ser escrita sem encostar no rodapé, que começa em
 * `PAGINA_A - 18`. Os 7mm de sobra cabem a descida do texto de 9pt.
 */
const LIMITE_UTIL = PAGINA_A - 25;

/** Título de seção numerada ("1. FINALIDADE"). */
function secao(doc: jsPDF, titulo: string, y: number): number {
	if (y > PAGINA_A - 40) {
		doc.addPage();
		y = MARGEM;
	}
	doc.setFont('helvetica', 'bold');
	doc.setFontSize(10);
	doc.text(titulo, MARGEM, y);
	doc.setFont('helvetica', 'normal');
	return y + 5.5;
}

/**
 * Quanto uma seção "título + parágrafo" vai ocupar, ANTES de escrevê-la.
 *
 * Existe para a regra do órfão: `secao`/`paragrafo` quebram a página quando o
 * espaço acabou, o que serve para texto corrido mas não para o fim do
 * documento. Sem medir antes, o corpo enche a folha e sobra uma segunda página
 * com a data e a assinatura do Diretor e mais nada — assinatura desacompanhada
 * do texto que ela assina é defeito de documento oficial, não questão de gosto.
 */
function alturaSecao(doc: jsPDF, texto: string): number {
	return 5.5 + doc.splitTextToSize(texto, UTIL).length * LINHA;
}

/** Página 1: as oito seções, o fecho e a assinatura. */
function corpo(doc: jsPDF, d: PlanoPdfData) {
	let y = timbre(doc, 26);

	doc.setFont('helvetica', 'bold');
	doc.setFontSize(13);
	doc.text(`PLANO OPERACIONAL ${d.numero}/${d.ano}`, PAGINA_L / 2, y, { align: 'center' });
	y += 7;
	doc.setFontSize(11);
	doc.text(d.nome.toUpperCase(), PAGINA_L / 2, y, { align: 'center' });
	y += 6;
	doc.setFont('helvetica', 'normal');
	doc.setFontSize(10);
	doc.text(
		`Dia ${formatarData(d.data_inicio)} (${diaSemanaExtenso(d.data_inicio)})`,
		PAGINA_L / 2,
		y,
		{ align: 'center' }
	);
	y += 4;
	if (d.nup) {
		doc.setFontSize(9);
		doc.text(`NUP: ${d.nup}`, PAGINA_L / 2, y, { align: 'center' });
		y += 5;
		doc.setFontSize(10);
	}
	y += 4;

	y = secao(doc, '1. FINALIDADE', y);
	y = paragrafo(doc, d.finalidade, y);
	y += ENTRE_SECOES;

	y = secao(doc, '2. CALENDÁRIO', y);
	y = paragrafo(doc, 'a) Cronograma operacional:', y);
	const cronograma: Array<[string, string]> = [
		[
			'DATA DE APRESENTAÇÃO:',
			`${formatarData(d.data_inicio)} (${diaSemanaExtenso(d.data_inicio)})`
		],
		['HORÁRIO DE APRESENTAÇÃO:', `${d.hora_inicio}h`],
		['LOCAL DE APRESENTAÇÃO:', 'Conforme anexo I.']
	];
	for (const [rotulo, valor] of cronograma) {
		doc.text(rotulo, MARGEM + 5, y);
		doc.text(valor, MARGEM + 62, y);
		y += 5;
	}
	y += 2;
	y = paragrafo(doc, 'b) Ações a serem realizadas:', y);
	for (const acao of d.acoes.split('\n').filter((a) => a.trim())) {
		y = paragrafo(doc, `- ${acao.trim().replace(/^-\s*/, '')}`, y, {
			x: MARGEM + 5,
			largura: UTIL - 5
		});
	}
	y += ENTRE_SECOES;

	y = secao(doc, '3. REFERÊNCIAS', y);
	y = paragrafo(doc, REFERENCIAS_PADRAO, y);
	y += ENTRE_SECOES;

	y = secao(doc, '4. PARTICIPANTES', y);
	y = paragrafo(doc, 'Conforme anexo I.', y);
	y += ENTRE_SECOES;

	y = secao(doc, '5. EXECUÇÃO', y);
	y = paragrafo(doc, `A cargo do ${d.departamento}.`, y);
	y += ENTRE_SECOES;

	y = secao(doc, '6. EFETIVO EMPREGADO', y);
	y = paragrafo(doc, 'Conforme Anexo I.', y);
	y += ENTRE_SECOES;

	y = secao(doc, '7. CUSTOS OPERACIONAIS', y);
	y = paragrafo(doc, 'Conforme Anexo II.', y);
	y += ENTRE_SECOES;

	// ---- Fim do documento: coordenador, demandante e o fecho ----
	//
	// A quebra é decidida AQUI, para os três de uma vez. Deixar cada bloco
	// quebrar por conta própria produz a página órfã: o corpo enche a folha, o
	// fecho não cabe, e a assinatura do Diretor sai numa segunda página sozinha.
	// Medindo antes, ou os três ficam nesta folha, ou os três vão para a
	// próxima — e aí a assinatura vai acompanhada do texto que ela assina.
	const textoCoordenador = d.coordenador
		? `${d.coordenador.nome}, DPC, Mat. ${d.coordenador.matricula} - ${d.coordenador.lotacao}`
		: 'A designar.';
	const alturaFim =
		alturaSecao(doc, textoCoordenador) +
		4 +
		(d.demandante ? alturaSecao(doc, d.demandante) : 0) +
		ALTURA_FECHO;

	if (y + alturaFim > LIMITE_UTIL) {
		doc.addPage();
		y = MARGEM;
	}

	y = secao(doc, '8. COORDENADOR', y);
	y = paragrafo(doc, textoCoordenador, y);
	y += 4;

	if (d.demandante) {
		y = secao(doc, '9. DEMANDANTE', y);
		y = paragrafo(doc, d.demandante, y);
	}

	y += 8;
	doc.text(
		`${CIDADE_EMISSAO}, ${formatarDataExtenso(new Date(d.emitidoEm + 'T12:00:00'))}.`,
		PAGINA_L / 2,
		y,
		{ align: 'center' }
	);

	y += 18;
	doc.setFont('helvetica', 'bold');
	doc.text(d.diretor_nome || '_'.repeat(40), PAGINA_L / 2, y, { align: 'center' });
	y += 5;
	doc.setFont('helvetica', 'normal');
	doc.setFontSize(9);
	doc.text(d.diretor_cargo, PAGINA_L / 2, y, { align: 'center' });
	doc.setFontSize(10);
}

/** Página 2: ANEXO I — uma seção por equipe, com o efetivo e o custo. */
function anexoI(doc: JsPDFWithAutoTable, d: PlanoPdfData) {
	doc.addPage();
	let y = timbre(doc, 26);

	doc.setFont('helvetica', 'bold');
	doc.setFontSize(11);
	doc.text('ANEXO I - DETALHAMENTO DE EQUIPES E CUSTOS', PAGINA_L / 2, y, { align: 'center' });
	doc.setFont('helvetica', 'normal');
	doc.setFontSize(10);
	y += 10;

	for (const eq of d.equipes) {
		const custoEquipe = d.custo.equipes.find((c) => c.equipe.id === eq.id);

		if (y > PAGINA_A - 60) {
			doc.addPage();
			y = MARGEM;
		}

		doc.setFont('helvetica', 'bold');
		doc.setFontSize(10);
		doc.text(eq.nome.toUpperCase() + (eq.tipo === 'seint' ? ' (SEINT)' : ''), MARGEM, y);
		doc.setFont('helvetica', 'normal');
		doc.setFontSize(8);
		y += 4.5;

		const vtr = [eq.viatura_modelo, eq.viatura_placa].filter(Boolean).join(' ');
		const cabecalho = [
			`Destino: ${eq.cidade_destino || '—'}`,
			`VTR: ${vtr || '—'}`,
			`Apresentação: ${eq.horaApresentacao}`,
			`Briefing: ${eq.briefing || '—'}`
		].join(' | ');
		y = paragrafo(doc, cabecalho, y);
		y += 1;

		// Uma linha por membro: identificação, jornada e o custo dele. O rótulo do
		// custo é o mesmo da tela (`rotuloCustoDaEquipe`), de uma fonte só.
		const linhas = eq.membros.map((m) => {
			const linhaCusto = custoEquipe?.membros.find((c) => c.membro.policial_id === m.policial_id);
			const quantidade =
				eq.tipo_custo === 'hora_extra'
					? resumoHoras(eq.horas_normais, eq.horas_plus)
					: eq.tipo_custo === 'diaria'
						? formatarDiarias(eq.diarias_meias)
						: '—';
			return [
				`${m.chefe ? '* ' : ''}${m.nome}`,
				`${m.cargo_snapshot} ${m.classe_snapshot || '—'}`,
				m.matricula,
				m.lotacao,
				m.telefone ?? '',
				quantidade,
				rotuloCustoDaEquipe(eq.tipo_custo, eq.diaria_tipo),
				linhaCusto ? formatarBRL(linhaCusto.total) : '—'
			];
		});

		if (linhas.length === 0) {
			y = paragrafo(doc, 'Sem efetivo alocado.', y, { x: MARGEM + 3 });
		} else {
			autoTable(doc, {
				startY: y,
				head: [
					[
						'Nome',
						'Cargo/Classe',
						'Matrícula',
						'Lotação',
						'Telefone',
						'Jornada',
						'Rubrica',
						'Valor'
					]
				],
				body: linhas,
				theme: 'grid',
				styles: { fontSize: 7, cellPadding: 1.2, overflow: 'linebreak' },
				headStyles: { fillColor: [235, 235, 235], textColor: 20, fontStyle: 'bold' },
				columnStyles: {
					0: { cellWidth: 40 },
					5: { halign: 'center' },
					7: { halign: 'right' }
				},
				margin: { left: MARGEM, right: MARGEM }
			});
			y = (doc.lastAutoTable?.finalY ?? y) + 3;
		}

		doc.setFont('helvetica', 'bold');
		doc.setFontSize(8);
		doc.text(`Total: ${formatarBRL(custoEquipe?.total ?? 0)}`, PAGINA_L - MARGEM, y, {
			align: 'right'
		});
		doc.setFont('helvetica', 'normal');
		doc.setFontSize(10);
		y += 8;
	}

	// O asterisco só faz sentido se houver chefe designado em alguma equipe.
	if (d.equipes.some((e) => e.membros.some((m) => m.chefe))) {
		doc.setFontSize(7);
		doc.text('* Chefe de equipe.', MARGEM, y);
		doc.setFontSize(10);
	}
}

/** Página 3: ANEXO II — o consolidado por categoria. */
function anexoII(doc: JsPDFWithAutoTable, d: PlanoPdfData) {
	doc.addPage();
	let y = timbre(doc, 26);

	doc.setFont('helvetica', 'bold');
	doc.setFontSize(11);
	doc.text('ANEXO II - CONSOLIDADO FINANCEIRO', PAGINA_L / 2, y, { align: 'center' });
	doc.setFont('helvetica', 'normal');
	doc.setFontSize(10);
	y += 12;

	/** Um bloco do anexo: título, linhas por categoria e a linha TOTAL. */
	function bloco(titulo: string, linhas: typeof d.custo.consolidado.dro, total: number) {
		doc.setFont('helvetica', 'bold');
		doc.setFontSize(9);
		doc.text(titulo, MARGEM, y);
		doc.setFont('helvetica', 'normal');
		doc.setFontSize(10);
		y += 4;

		const corpoTabela = linhas.map((l) => [
			ROTULO_CATEGORIA[l.categoria],
			String(l.quantidade),
			formatarBRL(l.total)
		]);
		// A linha TOTAL entra mesmo com o bloco vazio: um anexo financeiro que
		// simplesmente omite a seção deixa o leitor sem saber se é zero ou se
		// faltou imprimir.
		corpoTabela.push([
			'TOTAL',
			String(linhas.reduce((s, l) => s + l.quantidade, 0)),
			formatarBRL(total)
		]);

		autoTable(doc, {
			startY: y,
			head: [['CATEGORIA', 'QUANTIDADE', 'CUSTO TOTAL']],
			body: corpoTabela,
			theme: 'grid',
			styles: { fontSize: 8, cellPadding: 2 },
			headStyles: { fillColor: [235, 235, 235], textColor: 20, fontStyle: 'bold' },
			// Largura FIXA nas três colunas (90 + 35 + 45 = os 170mm úteis).
			// Sem isto o autoTable dimensiona cada bloco pelo conteúdo dele, e os
			// dois quadros do anexo — que o leitor compara linha a linha — saem com
			// as colunas desalinhadas entre si: "Delegados (DPC)" alarga o primeiro,
			// e o TOTAL de um fica a centímetros do TOTAL do outro.
			columnStyles: {
				0: { cellWidth: 90 },
				1: { cellWidth: 35, halign: 'center' },
				2: { cellWidth: 45, halign: 'right' }
			},
			// A última linha (TOTAL) em negrito.
			didParseCell: (dados) => {
				if (dados.section === 'body' && dados.row.index === corpoTabela.length - 1) {
					dados.cell.styles.fontStyle = 'bold';
				}
			},
			margin: { left: MARGEM, right: MARGEM }
		});
		y = (doc.lastAutoTable?.finalY ?? y) + 10;
	}

	bloco(TITULO_DRO, d.custo.consolidado.dro, d.custo.consolidado.droTotal);
	bloco(TITULO_DIARIAS, d.custo.consolidado.diarias, d.custo.consolidado.diariasTotal);

	doc.setFont('helvetica', 'bold');
	doc.setFontSize(11);
	doc.text('TOTAL GERAL', MARGEM, y);
	doc.text(formatarBRL(d.custo.consolidado.totalGeral), PAGINA_L - MARGEM, y, { align: 'right' });
	doc.setFont('helvetica', 'normal');
	doc.setFontSize(8);
	y += 8;

	doc.text('* Valores estimados.', MARGEM, y);
	y += 4;
	if (d.versaoValores) {
		// A procedência do número. Sem ela, um total reemitido depois de um
		// reajuste seria indistinguível de um erro de cálculo.
		doc.text(
			`Tabela de valores nº ${d.versaoValores.id}, vigente desde ${formatarData(d.versaoValores.vigente_desde)}.`,
			MARGEM,
			y
		);
	}
	doc.setFontSize(10);
}

/**
 * Gera o PDF do plano operacional.
 *
 * `logoEsqBytes`/`logoDirBytes` são opcionais e best-effort: o documento tem de
 * sair mesmo sem timbre — ver `embutirLogosNoTopo`.
 */
export async function gerarPdfPlanoOperacional(
	dados: PlanoPdfData,
	logoEsqBytes?: Uint8Array,
	logoDirBytes?: Uint8Array
): Promise<PdfExportResult> {
	const doc = new jsPDF({
		orientation: 'portrait',
		unit: 'mm',
		format: 'a4'
	}) as JsPDFWithAutoTable;

	corpo(doc, dados);
	anexoI(doc, dados);
	anexoII(doc, dados);
	// Por último: `rodape` percorre TODAS as páginas, e as duas funções acima
	// ainda podem abrir páginas novas por transbordo.
	rodape(doc);

	const bytes = new Uint8Array(doc.output('arraybuffer'));
	const comLogos = await embutirLogosNoTopo(bytes, logoEsqBytes, logoDirBytes, LOGOS_PLANO);

	return { pdf: comLogos, finalY: 0, pageHeightMm: PAGINA_A };
}
