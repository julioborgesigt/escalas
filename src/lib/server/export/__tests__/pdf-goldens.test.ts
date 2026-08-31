/**
 * GOLDENS dos PDFs de exportação — proteção de layout byte a byte.
 *
 * Os PDFs gerados aqui são artefatos com valor jurídico (documentos que o
 * policial assina). Este harness congela o relógio, gera cada tipo de PDF a
 * partir de fixtures fixas e compara o SHA-256 com o golden versionado em
 * `fixtures/pdf-goldens.json` — qualquer refactor em `pdf.ts`
 * (ou nos helpers de `shared.ts`) que altere UM byte do resultado
 * falha o teste.
 *
 * Cada gerador roda DUAS vezes por execução: hashes diferentes entre as duas
 * rodadas indicam não-determinismo (timestamp/random novo no código), que
 * quebraria o golden — o teste aponta isso separadamente.
 *
 * Para regravar goldens após uma mudança de layout INTENCIONAL:
 *   UPDATE_PDF_GOLDENS=1 npx vitest run pdf-goldens
 * e revise o diff visual dos PDFs antes de commitar o JSON.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	gerarPdf,
	gerarPdfExpediente,
	gerarPdfPlantao,
	gerarPdfGise,
	gerarRelatorioProdutividadeGisePdf,
	toGisePdfData
} from '../pdf';
import {
	gerarRelatorioExtraordinarioPdf,
	gerarRelatorioExtraordinarioSupervisaoPdf,
	gerarPdfRelatorioExtraordinario
} from '../pdf-relatorio-extra';
import { gerarPdfPlanoOperacional, type PlanoPdfData } from '../pdf-plano-operacional';
import type { Escala, EscalaPolicialComDados } from '../../../types';
import type { GiseDetalhado } from '$lib/db';
import type { CustoPlano } from '$lib/planos/custo';

const GOLDENS_PATH = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'pdf-goldens.json');
const UPDATE = process.env.UPDATE_PDF_GOLDENS === '1';
const FUSO_ORIGINAL = process.env.TZ;

// PNG 1×1 válido — exercita os caminhos de addImage (logo/QR).
const PNG_1PX =
	'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PNG_1PX_BYTES = Uint8Array.from(atob(PNG_1PX.split(',')[1]), (c) => c.charCodeAt(0));

/**
 * JPEG 1×1 baseline — os LOGOS passam por `pdf-lib.embedJpg`, que rejeita PNG.
 *
 * Sem isto os goldens exercitavam só o caminho de FALHA do timbre (o `catch`
 * que devolve o PDF sem logo), e a geometria de posicionamento — que difere
 * entre expediente e GISE — não era coberta por nada. Os dois casos
 * `*_com_logos` abaixo existem para travá-la.
 */
const JPG_1PX_BYTES = Uint8Array.from(
	atob(
		'/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAALCAABAAEBAREA/8QAHwAAAQAAAAAAAAAAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8gISIjJCUmJygpKissLS4vMDEyMzQ1Njc4OTo7PD0+P0BBQkNERUZHSElKS0xNTk9QUVJTVFVWV1hZWltcXV5fYGFiY2RlZmdoaWprbG1ub3BxcnN0dXZ3eHl6e3x9fn+AgYKDhIWGh4iJiouMjY6PkJGSk5SVlpeYmZqbnJ2en6Ch/9oACAEBAAA/AAD/2Q=='
	),
	(c) => c.charCodeAt(0)
);

/**
 * Zera o identificador de arquivo (`/ID [ <…> <…> ]`) do trailer antes do
 * hash: o jsPDF o gera aleatoriamente a cada execução e ele não faz parte do
 * LAYOUT — todo o resto do PDF continua protegido byte a byte.
 */
function normalizarPdf(bytes: Uint8Array): Buffer {
	const latin1 = Buffer.from(bytes).toString('latin1');
	const normalizado = latin1.replace(
		/\/ID \[ <[0-9A-Fa-f]+> <[0-9A-Fa-f]+> \]/g,
		'/ID [ <0> <0> ]'
	);
	return Buffer.from(normalizado, 'latin1');
}

function sha256(bytes: Uint8Array): string {
	return createHash('sha256').update(normalizarPdf(bytes)).digest('hex');
}

// ─── Fixtures determinísticas ────────────────────────────────────────────────

function escalaFixture(tipo: 'plantao' | 'expediente' | 'fds'): Escala {
	return {
		id: 90001,
		titulo: `ESCALA GOLDEN ${tipo.toUpperCase()} – JULHO 2026`,
		cidade: 'Fortaleza',
		tipo,
		lotacao: 'DELEGACIA GOLDEN',
		data_inicio: '2026-07-01',
		data_fim: tipo === 'fds' ? '2026-07-05' : '2026-07-31',
		horario: '08:00 às 08:00',
		hora_entrada: '08:00',
		hora_saida: tipo === 'plantao' ? '08:00' : '17:00'
	} as unknown as Escala;
}

function policiaisFixture(): EscalaPolicialComDados[] {
	const base = {
		escala_id: 90001,
		hora_entrada: '08:00',
		hora_saida: '08:00',
		data_saida: '',
		classe: '2ª CLASSE',
		regime: 'INTEGRAL',
		lotacao: 'DELEGACIA GOLDEN'
	};
	return [
		{
			...base,
			id: 1,
			policial_id: 501,
			nome: 'ANA GOLDEN DPC',
			matricula: 'GG000001',
			cargo: 'DPC',
			telefone: '(85) 99999-0001',
			equipe: 'EQUIPE A',
			data_plantao: '2026-07-01',
			observacoes: 'Coordenação'
		},
		{
			...base,
			id: 2,
			policial_id: 502,
			nome: 'BRUNO GOLDEN OIP',
			matricula: 'GG000002',
			cargo: 'OIP',
			telefone: '(85) 99999-0002',
			equipe: 'EQUIPE A',
			data_plantao: '2026-07-01',
			observacoes: ''
		},
		{
			...base,
			id: 3,
			policial_id: 503,
			nome: 'CARLA GOLDEN OIP',
			matricula: 'GG000003',
			cargo: 'OIP',
			telefone: '(85) 99999-0003',
			equipe: 'EQUIPE B',
			data_plantao: '2026-07-05',
			observacoes: 'Plantão noturno'
		}
	] as unknown as EscalaPolicialComDados[];
}

function giseDetalhadoFixture(): GiseDetalhado {
	return {
		id: 90001,
		data_inicio: '2026-07-04',
		feriado: 0,
		hora_entrada: '08:00',
		hora_saida: '16:00',
		status: 'em_andamento',
		supervisor_id: 601,
		supervisor_nome: 'DPC GOLDEN SUPERVISOR',
		supervisor_matricula: 'GG000601',
		supervisor_telefone: '(85) 98888-0601',
		assessor_id: 602,
		assessor_nome: 'ASSESSOR GOLDEN',
		assessor_matricula: 'GG000602',
		assessor_telefone: '(85) 98888-0602',
		seint1_id: 603,
		seint1_nome: 'SEINT GOLDEN UM',
		seint1_matricula: 'GG000603',
		seint1_telefone: '(85) 98888-0603',
		seint2_id: null,
		seint2_nome: null,
		seint2_matricula: null,
		seint2_telefone: null,
		breve_relatorio_titulo: null,
		breve_relatorio_texto_seccional: null,
		breve_relatorio_texto_supervisao: null,
		seccionais: [
			{
				id: 1,
				seccional_id: 71,
				seccional_nome: 'SECCIONAL GOLDEN',
				status: 'preenchida',
				hora_entrada: '08:00',
				hora_saida: '16:00',
				// Shape real do buscarGiseDetalhado: equipes aninhadas em unidades-slot.
				unidades: [
					{
						id: 5,
						nome: 'DELEGACIA GOLDEN',
						equipes: [
							{
								id: 11,
								tipo: 'operacional',
								slots_dpc: 1,
								slots_oip: 3,
								hora_entrada: '08:00',
								hora_saida: '16:00',
								membros: [
									{
										id: 21,
										policial_id: 501,
										policial_nome: 'ANA GOLDEN DPC',
										policial_cargo: 'DPC',
										policial_matricula: 'GG000001',
										policial_telefone: '(85) 99999-0001',
										policial_lotacao: 'DELEGACIA GOLDEN',
										policial_classe: '2ª CLASSE',
										presenca: {
											entrada_timestamp: '2026-07-04T08:02:00.000Z',
											saida_timestamp: '2026-07-04T16:01:00.000Z'
										}
									},
									{
										id: 22,
										policial_id: 502,
										policial_nome: 'BRUNO GOLDEN OIP',
										policial_cargo: 'OIP',
										policial_matricula: 'GG000002',
										policial_telefone: '(85) 99999-0002',
										policial_lotacao: 'DELEGACIA GOLDEN',
										policial_classe: '1ª CLASSE',
										presenca: null
									}
								]
							}
						]
					}
				]
			}
		],
		documento: null
	} as unknown as GiseDetalhado;
}

function presencasFixture() {
	return [
		{
			id: 1,
			gise_id: 90001,
			policial_id: 501,
			policial_nome: 'ANA GOLDEN DPC',
			policial_matricula: 'GG000001',
			policial_cpf: null,
			policial_cargo: 'DPC',
			policial_classe: '2ª CLASSE',
			policial_lotacao: 'DELEGACIA GOLDEN',
			entrada_timestamp: '2026-07-04T08:02:00.000Z',
			entrada_selfie_key: null,
			saida_timestamp: '2026-07-04T16:01:00.000Z',
			saida_selfie_key: null,
			ip_address: null,
			user_agent: null,
			latitude: null,
			longitude: null
		},
		{
			id: 2,
			gise_id: 90001,
			policial_id: 502,
			policial_nome: 'BRUNO GOLDEN OIP',
			policial_matricula: 'GG000002',
			policial_cpf: null,
			policial_cargo: 'OIP',
			policial_classe: '1ª CLASSE',
			policial_lotacao: 'DELEGACIA GOLDEN',
			entrada_timestamp: '2026-07-04T08:05:00.000Z',
			entrada_selfie_key: null,
			saida_timestamp: null,
			saida_selfie_key: null,
			ip_address: null,
			user_agent: null,
			latitude: null,
			longitude: null
		}
	];
}

const reportSignatureFixture = {
	assinante_nome: 'DPC GOLDEN SUPERVISOR',
	assinante_matricula: 'GG000601',
	verification_hash: 'golden-verification-hash',
	created_at: '2026-07-04T18:30:00.000Z'
};

/**
 * Plano operacional com os três tipos de custo ao mesmo tempo.
 *
 * As três equipes não são decoração: cada uma congela um caminho diferente do
 * gerador — a de hora extra imprime `6h (5N/1A)` e as duas categorias do bloco
 * DRO, a de diária alimenta o segundo bloco do Anexo II, e a SEINT sem custo
 * prova que o rótulo "Sem custo" e o subtotal zerado continuam saindo (equipe
 * omitida do anexo deixaria o leitor sem saber se é zero ou se faltou
 * imprimir).
 *
 * O `custo` vem escrito à mão, e não de `custoDoPlano`: o golden trava o
 * LAYOUT. Recalcular aqui faria uma mudança na regra de custo quebrar o golden
 * do PDF, que é o teste errado reclamando.
 */
function planoFixture(): PlanoPdfData {
	const membro = (
		policial_id: number,
		nome: string,
		cargo: string,
		classe: string,
		chefe = false
	) => ({
		policial_id,
		nome,
		matricula: `GG${String(policial_id).padStart(6, '0')}`,
		lotacao: '4ª Seccional do Interior Sul',
		telefone: '(85) 99999-0001',
		cargo_snapshot: cargo,
		classe_snapshot: classe,
		chefe
	});

	return {
		numero: 7,
		ano: 2026,
		nome: 'Operação Golden',
		finalidade: 'Cumprimento de mandados judiciais na comarca golden, com apoio das equipes.',
		acoes: 'Cumprimento de Mandados;\nLavratura de APF;\nOutros atos de Polícia Judiciária.',
		nup: '2026.01.00000',
		data_inicio: '2026-07-04',
		hora_inicio: '05:00',
		departamento: 'DPI SUL',
		coordenador: {
			nome: 'DPC GOLDEN COORDENADOR',
			matricula: 'GG000601',
			lotacao: '4ª Seccional do Interior Sul'
		},
		demandante: 'Delegacia Regional Golden',
		diretor_nome: 'DIRETOR GOLDEN',
		diretor_cargo: 'Diretor Titular do Departamento de Polícia do Interior Sul',
		equipes: [
			{
				id: 1,
				nome: 'Equipe 01',
				tipo: 'operacional',
				viatura_modelo: 'Hilux',
				viatura_placa: 'GLD-0001',
				cidade_destino: 'Iguatu',
				tipo_custo: 'hora_extra',
				horas_normais: 5,
				horas_plus: 1,
				diaria_tipo: null,
				diarias_meias: 0,
				horaApresentacao: '05:00',
				briefing: 'Sede da Seccional Golden',
				membros: [
					membro(701, 'DPC GOLDEN UM', 'DPC', '2ª', true),
					membro(702, 'OIP GOLDEN UM', 'OIP', 'C')
				]
			},
			{
				id: 2,
				nome: 'Equipe 02',
				tipo: 'operacional',
				viatura_modelo: 'Duster',
				viatura_placa: 'GLD-0002',
				cidade_destino: 'Juazeiro do Norte',
				tipo_custo: 'diaria',
				horas_normais: 0,
				horas_plus: 0,
				diaria_tipo: 'estadual',
				diarias_meias: 3,
				horaApresentacao: '03:30',
				briefing: 'Sede da Seccional Golden',
				membros: [membro(703, 'OIP GOLDEN DOIS', 'OIP', 'A', true)]
			},
			{
				id: 3,
				nome: 'Equipe SEINT',
				tipo: 'seint',
				viatura_modelo: '',
				viatura_placa: '',
				cidade_destino: '',
				tipo_custo: 'sem_custo',
				horas_normais: 0,
				horas_plus: 0,
				diaria_tipo: null,
				diarias_meias: 0,
				horaApresentacao: '08:00',
				briefing: '',
				membros: [membro(704, 'OIP GOLDEN TRES', 'OIP', 'D')]
			}
		],
		custo: {
			equipes: [
				{
					equipe: { id: 1, nome: 'Equipe 01' },
					membros: [
						{
							membro: { policial_id: 701, nome: 'DPC GOLDEN UM' },
							faixa: 'dpc_12',
							total: 39000
						},
						{
							membro: { policial_id: 702, nome: 'OIP GOLDEN UM' },
							faixa: 'oip_cd',
							total: 17145
						}
					],
					total: 56145
				},
				{
					equipe: { id: 2, nome: 'Equipe 02' },
					membros: [
						{
							membro: { policial_id: 703, nome: 'OIP GOLDEN DOIS' },
							faixa: 'oip_ab',
							total: 52500
						}
					],
					total: 52500
				},
				{
					equipe: { id: 3, nome: 'Equipe SEINT' },
					membros: [
						{ membro: { policial_id: 704, nome: 'OIP GOLDEN TRES' }, faixa: 'oip_cd', total: 0 }
					],
					total: 0
				}
			],
			consolidado: {
				dro: [
					{ categoria: 'dpc', quantidade: 1, total: 39000 },
					{ categoria: 'oip', quantidade: 1, total: 17145 }
				],
				droTotal: 56145,
				diarias: [{ categoria: 'oip', quantidade: 1, total: 52500 }],
				diariasTotal: 52500,
				totalGeral: 108645
			},
			pendencias: [],
			avisos: []
		} as unknown as CustoPlano,
		versaoValores: { id: 3, vigente_desde: '2026-01-01' },
		emitidoEm: '2026-07-01'
	};
}

// ─── Geradores sob teste ─────────────────────────────────────────────────────

const geradores: Record<string, () => Promise<Uint8Array>> = {
	fds: async () => gerarPdf(escalaFixture('fds'), policiaisFixture()).pdf,
	expediente: async () =>
		(
			await gerarPdfExpediente(
				escalaFixture('expediente'),
				policiaisFixture(),
				PNG_1PX_BYTES,
				PNG_1PX_BYTES
			)
		).pdf,
	plantao: async () => gerarPdfPlantao(escalaFixture('plantao'), policiaisFixture()).pdf,
	gise: async () =>
		(await gerarPdfGise(toGisePdfData(giseDetalhadoFixture()), PNG_1PX_BYTES, PNG_1PX_BYTES)).pdf,
	// Os dois abaixo repetem os de cima com o timbre em JPEG, para que ele seja
	// DESENHADO em vez de cair no catch. Expediente e GISE usam geometrias
	// diferentes (42mm a 3mm do topo vs 45mm a 5mm) — é essa diferença que
	// estes goldens congelam.
	expediente_com_logos: async () =>
		(
			await gerarPdfExpediente(
				escalaFixture('expediente'),
				policiaisFixture(),
				JPG_1PX_BYTES,
				JPG_1PX_BYTES
			)
		).pdf,
	// GISE com `documento` preenchido: o `gise` acima passa `documento: null`, e
	// é o hash de verificação daqui que percorre o caminho do documento assinado.
	gise_com_logos: async () => {
		const gise = giseDetalhadoFixture();
		(gise as unknown as { documento: unknown }).documento = {
			verificacao_hash: 'golden-verification-hash'
		};
		return (await gerarPdfGise(toGisePdfData(gise), JPG_1PX_BYTES, JPG_1PX_BYTES)).pdf;
	},
	produtividade: async () =>
		gerarRelatorioProdutividadeGisePdf({
			gise: { data_inicio: '2026-07-04' },
			seccional: {
				id: 1,
				seccional_id: 71,
				seccional_nome: 'SECCIONAL GOLDEN',
				equipes: [{ id: 11, tipo: 'operacional' }]
			},
			respostas: [
				{ equipe_id: 11, pergunta: '1. VTR E PLACA', resposta: 'VTR GOLDEN / ABC-1234' },
				{ equipe_id: 11, pergunta: '18. Nº ABORDAGENS', resposta: '7' }
			]
		}).pdf,
	relatorio_extra_seccional: async () =>
		(
			await gerarRelatorioExtraordinarioPdf(
				toGisePdfData(giseDetalhadoFixture()),
				presencasFixture(),
				71,
				'https://escalas.pages.dev',
				reportSignatureFixture,
				PNG_1PX,
				false,
				PNG_1PX_BYTES,
				PNG_1PX_BYTES
			)
		).pdf,
	relatorio_extra_supervisao: async () =>
		(
			await gerarRelatorioExtraordinarioSupervisaoPdf(
				giseDetalhadoFixture(),
				presencasFixture(),
				'https://escalas.pages.dev',
				reportSignatureFixture,
				PNG_1PX,
				false,
				undefined,
				PNG_1PX_BYTES,
				PNG_1PX_BYTES
			)
		).pdf,
	plano_operacional: async () => (await gerarPdfPlanoOperacional(planoFixture())).pdf,
	// Com timbre em JPEG: o plano é RETRATO e sua geometria de logo (35mm a 8mm
	// do topo, numa página de 210mm) é diferente da do expediente e da do GISE.
	// Sem este caso, `embutirLogosNoTopo` só rodaria aqui pelo caminho do catch.
	plano_operacional_com_logos: async () =>
		(await gerarPdfPlanoOperacional(planoFixture(), JPG_1PX_BYTES, JPG_1PX_BYTES)).pdf
};

// ─── Testes ──────────────────────────────────────────────────────────────────

describe('export/pdf — goldens de layout', () => {
	beforeAll(() => {
		// jsPDF serializa /CreationDate com o offset local. O CI roda em UTC,
		// mas o desenvolvedor pode estar em UTC-3; fixar o fuso preserva o
		// contrato byte a byte do golden em qualquer máquina.
		process.env.TZ = 'UTC';
		// Congela SOMENTE Date: jsPDF grava /CreationDate e os cabeçalhos usam
		// formatarDataExtenso(new Date()). Timers reais seguem funcionando.
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date('2026-07-01T12:00:00.000Z'));
	});
	afterAll(() => {
		vi.useRealTimers();
		if (FUSO_ORIGINAL === undefined) {
			delete process.env.TZ;
		} else {
			process.env.TZ = FUSO_ORIGINAL;
		}
	});

	const goldens: Record<string, { sha256: string; bytes: number }> = existsSync(GOLDENS_PATH)
		? JSON.parse(readFileSync(GOLDENS_PATH, 'utf8'))
		: {};
	const atualizados: Record<string, { sha256: string; bytes: number }> = {};

	for (const [nome, gerar] of Object.entries(geradores)) {
		it(`${nome}: determinístico e igual ao golden`, async () => {
			const a = await gerar();
			const b = await gerar();
			const hashA = sha256(a);
			// Não-determinismo (timestamp/random novo no gerador) quebraria o
			// golden a cada run — falha com mensagem própria.
			expect(sha256(b), `${nome}: gerador não-determinístico`).toBe(hashA);

			atualizados[nome] = { sha256: hashA, bytes: a.length };
			if (UPDATE) {
				// Despeja o PDF para inspeção visual antes de commitar o golden novo.
				const dir = join(tmpdir(), 'escalas-pdf-goldens');
				mkdirSync(dir, { recursive: true });
				writeFileSync(join(dir, `${nome}.pdf`), a);
				return;
			}

			expect(
				goldens[nome],
				`golden ausente para '${nome}' — rode UPDATE_PDF_GOLDENS=1 vitest run pdf-goldens`
			).toBeDefined();
			expect(hashA).toBe(goldens[nome].sha256);
		});
	}

	afterAll(() => {
		if (UPDATE) {
			writeFileSync(GOLDENS_PATH, JSON.stringify(atualizados, null, '\t') + '\n');
			console.log(`[goldens] regravados em ${GOLDENS_PATH}`);
		}
	});
});

/**
 * `gerarPdfRelatorioExtraordinario` decide entre as duas funções acima e
 * NOMEIA os 9 parâmetros que elas tomam posicionalmente — exatamente onde uma
 * ordem trocada não dá erro de tipo, só resultado errado. Comparar contra a
 * chamada direta (com os mesmos valores, na ordem documentada) prova que a
 * composição do helper é bit a bit idêntica, sem duplicar golden hash.
 */
describe('export/pdf-relatorio-extra — gerarPdfRelatorioExtraordinario', () => {
	beforeAll(() => {
		process.env.TZ = 'UTC';
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date('2026-07-01T12:00:00.000Z'));
	});
	afterAll(() => {
		vi.useRealTimers();
		if (FUSO_ORIGINAL === undefined) delete process.env.TZ;
		else process.env.TZ = FUSO_ORIGINAL;
	});

	it('ramo seccional (isSupExtra: false) encaminha os mesmos bytes que a chamada direta', async () => {
		const direto = await gerarRelatorioExtraordinarioPdf(
			toGisePdfData(giseDetalhadoFixture()),
			presencasFixture(),
			71,
			'https://escalas.pages.dev',
			reportSignatureFixture,
			undefined,
			false,
			PNG_1PX_BYTES,
			PNG_1PX_BYTES
		);
		const viaHelper = await gerarPdfRelatorioExtraordinario({
			isSupExtra: false,
			gise: giseDetalhadoFixture(),
			presencas: presencasFixture(),
			seccionalId: 71,
			baseUrl: 'https://escalas.pages.dev',
			reportSignature: reportSignatureFixture,
			logoEsqBytes: PNG_1PX_BYTES,
			logoDirBytes: PNG_1PX_BYTES
		});
		expect(sha256(viaHelper.pdf)).toBe(sha256(direto.pdf));
	});

	it('ramo supervisão (isSupExtra: true) encaminha os mesmos bytes que a chamada direta', async () => {
		const direto = await gerarRelatorioExtraordinarioSupervisaoPdf(
			giseDetalhadoFixture(),
			presencasFixture(),
			'https://escalas.pages.dev',
			reportSignatureFixture,
			undefined,
			true,
			undefined,
			PNG_1PX_BYTES,
			PNG_1PX_BYTES
		);
		const viaHelper = await gerarPdfRelatorioExtraordinario({
			isSupExtra: true,
			gise: giseDetalhadoFixture(),
			presencas: presencasFixture(),
			baseUrl: 'https://escalas.pages.dev',
			reportSignature: reportSignatureFixture,
			isPreparando: true,
			logoEsqBytes: PNG_1PX_BYTES,
			logoDirBytes: PNG_1PX_BYTES
		});
		expect(sha256(viaHelper.pdf)).toBe(sha256(direto.pdf));
	});
});
