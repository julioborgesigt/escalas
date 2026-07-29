/**
 * Geração dos .docx de escala (FDS, expediente e plantão mensal).
 *
 * É o formato EDITÁVEL entregue às unidades — o PDF assinado é o documento
 * oficial (`export-pdf.ts`). Os dois consomem os mesmos agrupamentos de
 * `export-shared.ts`, de modo que a ordem dos nomes e os horários batem entre
 * as duas saídas; aqui só muda o desenho (tabelas do pacote `docx`).
 */
import {
	Document,
	Packer,
	Paragraph,
	Table,
	TableRow,
	TableCell,
	TextRun,
	WidthType,
	AlignmentType,
	BorderStyle,
	PageOrientation
} from 'docx';
import type { Escala, EscalaPolicialComDados } from '../types';
import { formatarData, formatarDataExtenso } from '../utils';
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

// ---- DOCX Final de Semana ----
/** Uma tabela por dia do fim de semana, na cor institucional (#1a5c57). */
export async function gerarDocx(
	escala: Escala,
	policiais: EscalaPolicialComDados[]
): Promise<Uint8Array> {
	const dias = agruparPorData(policiais);

	const titulo = new Paragraph({
		children: [
			new TextRun({
				text: `ESCALA PLANTÃO FINAL DE SEMANA ${escala.lotacao.toUpperCase()} ${formatarData(escala.data_inicio)} ${sepDatas(escala.data_inicio, escala.data_fim)} ${formatarData(escala.data_fim)}`,
				bold: true,
				size: 24,
				font: 'Arial'
			})
		],
		alignment: AlignmentType.CENTER,
		spacing: { after: 300 }
	});

	const tables: (Table | Paragraph)[] = [];

	for (const dia of dias) {
		const headerRow = new TableRow({
			children: [
				'EQUIPE DE PLANTÃO DA DP',
				'MATRÍCULA',
				'CARGO',
				'TELEFONE',
				'LOTAÇÃO',
				'DATA',
				'HORÁRIO'
			].map(
				(text) =>
					new TableCell({
						children: [
							new Paragraph({
								children: [
									new TextRun({ text, bold: true, size: 16, font: 'Arial', color: 'FFFFFF' })
								],
								alignment: AlignmentType.CENTER
							})
						],
						shading: { fill: '1a5c57' },
						width:
							text === 'EQUIPE DE PLANTÃO DA DP'
								? { size: 25, type: WidthType.PERCENTAGE }
								: text === 'LOTAÇÃO'
									? { size: 20, type: WidthType.PERCENTAGE }
									: text === 'DATA'
										? { size: 15, type: WidthType.PERCENTAGE }
										: { size: 10, type: WidthType.PERCENTAGE }
					})
			)
		});

		const dataRows = dia.policiais.map(
			(p) =>
				new TableRow({
					children: [
						p.nome,
						p.matricula,
						p.cargo,
						p.telefone || '',
						p.lotacao,
						formatarDataPlantao(p, escala),
						formatarHorario(p, escala)
					].map(
						(text, i) =>
							new TableCell({
								children: [
									new Paragraph({
										children: [new TextRun({ text, size: 18, font: 'Arial' })],
										alignment: i >= 5 ? AlignmentType.CENTER : AlignmentType.LEFT
									})
								],
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

		tables.push(
			new Table({
				rows: [headerRow, ...dataRows],
				width: { size: 100, type: WidthType.PERCENTAGE }
			})
		);
		tables.push(new Paragraph({ spacing: { after: 200 } }));
	}

	const doc = new Document({
		sections: [
			{
				properties: {
					page: {
						size: {
							width: 11906,
							height: 16838,
							orientation: PageOrientation.LANDSCAPE
						},
						margin: { top: 720, bottom: 720, left: 720, right: 720 }
					}
				},
				children: [titulo, ...tables]
			}
		]
	});

	const blob = await Packer.toBlob(doc);
	return new Uint8Array(await blob.arrayBuffer());
}

// ---- DOCX Expediente ----
/** Lista única de servidores, com o rodapé de local/data para assinatura. */
export async function gerarDocxExpediente(
	escala: Escala,
	policiais: EscalaPolicialComDados[]
): Promise<Uint8Array> {
	const sorted = sortExpediente(policiais);
	const NCOLS = COLS_EXPEDIENTE.length;
	const border = { style: BorderStyle.SINGLE, size: 4, color: '888888' };
	const borders = { top: border, bottom: border, left: border, right: border };

	function tealCell(text: string, opts: { span?: number; size?: number; center?: boolean } = {}) {
		return new TableCell({
			columnSpan: opts.span ?? 1,
			children: [
				new Paragraph({
					children: [
						new TextRun({ text, bold: true, size: opts.size ?? 18, font: 'Arial', color: 'FFFFFF' })
					],
					alignment: opts.center !== false ? AlignmentType.CENTER : AlignmentType.LEFT
				})
			],
			shading: { fill: '1a5c57' },
			borders
		});
	}

	function metaCell(text: string) {
		return new TableCell({
			columnSpan: NCOLS,
			children: [
				new Paragraph({
					children: [new TextRun({ text, bold: true, size: 18, font: 'Arial' })],
					alignment: AlignmentType.LEFT
				})
			],
			borders
		});
	}

	const obsText =
		'OBSERVAÇÕES: FÉRIAS (INFORMAR PERÍODO DE INÍCIO/FIM); LICENÇAS (INFORMAR PERÍODO DE INÍCIO/FIM E ANEXAR A DOCUMENTAÇÃO RELACIONADA).';

	const rows: TableRow[] = [
		new TableRow({ children: [tealCell('ESCALA DE EXPEDIENTE', { span: NCOLS, size: 22 })] }),
		new TableRow({ children: [metaCell(`DELEGACIA: ${escala.lotacao.toUpperCase()}`)] }),
		new TableRow({ children: [metaCell(`MÊS/ANO: ${formatarMesAno(escala.data_inicio)}`)] }),
		new TableRow({ children: COLS_EXPEDIENTE.map((c) => tealCell(c, { size: 16 })) }),
		...sorted.map(
			(p) =>
				new TableRow({
					children: rowExpediente(p).map(
						(text, i) =>
							new TableCell({
								children: [
									new Paragraph({
										children: [new TextRun({ text, size: 18, font: 'Arial' })],
										alignment: i >= 1 && i <= 4 ? AlignmentType.CENTER : AlignmentType.LEFT
									})
								],
								borders
							})
					)
				})
		),
		new TableRow({
			children: [
				new TableCell({
					columnSpan: NCOLS,
					children: [
						new Paragraph({
							children: [new TextRun({ text: obsText, bold: true, size: 16, font: 'Arial' })]
						})
					],
					shading: { fill: 'F5F5F5' },
					borders
				})
			]
		})
	];

	// "Iguatu, 05 de Julho de 2026" — omite a cidade quando ela repetiria o nome
	// da unidade (ex.: lotação "DELEGACIA DE IGUATU" na cidade "Iguatu").
	const localizacao = escala.cidade && escala.cidade !== escala.lotacao ? escala.cidade : '';
	const dataExtenso = formatarDataExtenso(new Date());
	const textoData = localizacao ? `${localizacao}, ${dataExtenso}` : dataExtenso;

	const doc = new Document({
		sections: [
			{
				properties: {
					page: {
						size: { width: 11906, height: 16838, orientation: PageOrientation.LANDSCAPE },
						margin: { top: 720, bottom: 720, left: 720, right: 720 }
					}
				},
				children: [
					new Paragraph({
						children: [
							new TextRun({ text: 'POLÍCIA CIVIL DO CEARÁ', bold: true, size: 20, font: 'Arial' })
						],
						alignment: AlignmentType.CENTER
					}),
					new Paragraph({
						children: [
							new TextRun({ text: 'DELEGACIA GERAL DA POLÍCIA CIVIL', size: 18, font: 'Arial' })
						],
						alignment: AlignmentType.CENTER
					}),
					new Paragraph({
						children: [
							new TextRun({
								text: 'DEPARTAMENTO DE POLÍCIA DO INTERIOR SUL',
								size: 18,
								font: 'Arial'
							})
						],
						alignment: AlignmentType.CENTER,
						spacing: { after: 200 }
					}),
					new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } }),
					new Paragraph({ children: [], spacing: { before: 200 } }),
					new Paragraph({
						children: [new TextRun({ text: textoData, bold: true, size: 18, font: 'Arial' })]
					}),
					new Paragraph({ children: [], spacing: { before: 400 } }),
					new Paragraph({
						children: [
							new TextRun({
								text: '_______________________________________________',
								size: 18,
								font: 'Arial'
							})
						]
					}),
					new Paragraph({
						children: [
							new TextRun({
								text: 'Delegado(a) de Polícia / assinado digitalmente',
								size: 16,
								font: 'Arial'
							})
						]
					})
				]
			}
		]
	});

	const blob = await Packer.toBlob(doc);
	return new Uint8Array(await blob.arrayBuffer());
}

// ---- DOCX Plantão ----
/** Uma tabela por equipe; cada policial ocupa uma linha com todos os seus dias. */
export async function gerarDocxPlantao(
	escala: Escala,
	policiais: EscalaPolicialComDados[]
): Promise<Uint8Array> {
	const equipes = agruparPlantao(policiais);

	const titulo = new Paragraph({
		children: [
			new TextRun({ text: 'POLÍCIA CIVIL DO ESTADO DO CEARÁ', bold: true, size: 22, font: 'Arial' })
		],
		alignment: AlignmentType.CENTER,
		spacing: { after: 100 }
	});

	const subtitulo = new Paragraph({
		children: [
			new TextRun({
				text: `DELEGACIA: ${escala.cidade.toUpperCase()} — MÊS/ANO: ${formatarMesAno(escala.data_inicio)}`,
				bold: true,
				size: 20,
				font: 'Arial'
			})
		],
		alignment: AlignmentType.CENTER,
		spacing: { after: 300 }
	});

	const borderStyle = { style: BorderStyle.SINGLE, size: 1 };
	const borders = { top: borderStyle, bottom: borderStyle, left: borderStyle, right: borderStyle };

	const children: (Table | Paragraph)[] = [titulo, subtitulo];

	for (const [equipe, oficiais] of equipes) {
		const equipeLabel = equipe ? `EQUIPE ${equipe}` : 'EQUIPE';
		children.push(
			new Paragraph({
				children: [
					new TextRun({ text: equipeLabel, bold: true, size: 20, font: 'Arial', color: '1a5c57' })
				],
				spacing: { before: 200, after: 100 }
			})
		);

		const headerRow = new TableRow({
			children: COLS_PLANTAO.map(
				(text) =>
					new TableCell({
						children: [
							new Paragraph({
								children: [
									new TextRun({ text, bold: true, size: 16, font: 'Arial', color: 'FFFFFF' })
								],
								alignment: AlignmentType.CENTER
							})
						],
						shading: { fill: '1a5c57' },
						borders
					})
			)
		});

		const dataRows = oficiais.map(
			(o) =>
				new TableRow({
					children: rowPlantao(o).map(
						(text, i) =>
							new TableCell({
								children: [
									new Paragraph({
										children: [new TextRun({ text, size: 18, font: 'Arial' })],
										alignment: i >= 1 && i <= 3 ? AlignmentType.CENTER : AlignmentType.LEFT
									})
								],
								borders
							})
					)
				})
		);

		children.push(
			new Table({
				rows: [headerRow, ...dataRows],
				width: { size: 100, type: WidthType.PERCENTAGE }
			})
		);
		children.push(new Paragraph({ spacing: { after: 100 } }));
	}

	const doc = new Document({
		sections: [
			{
				properties: {
					page: {
						size: {
							width: 11906,
							height: 16838,
							orientation: PageOrientation.LANDSCAPE
						},
						margin: { top: 720, bottom: 720, left: 720, right: 720 }
					}
				},
				children
			}
		]
	});

	const blob = await Packer.toBlob(doc);
	return new Uint8Array(await blob.arrayBuffer());
}
