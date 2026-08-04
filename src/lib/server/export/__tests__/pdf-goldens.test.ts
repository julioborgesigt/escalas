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
	gerarRelatorioExtraordinarioPdf,
	gerarRelatorioExtraordinarioSupervisaoPdf,
	toGisePdfData
} from '../pdf';
import type { Escala, EscalaPolicialComDados } from '../../../types';
import type { GiseDetalhado } from '$lib/db';

const GOLDENS_PATH = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'pdf-goldens.json');
const UPDATE = process.env.UPDATE_PDF_GOLDENS === '1';
const FUSO_ORIGINAL = process.env.TZ;

// PNG 1×1 válido — exercita os caminhos de addImage (logo/QR/rubrica).
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
											saida_timestamp: '2026-07-04T16:01:00.000Z',
											entrada_rubrica: PNG_1PX,
											saida_rubrica: PNG_1PX
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
			entrada_rubrica: PNG_1PX,
			entrada_selfie_key: null,
			saida_timestamp: '2026-07-04T16:01:00.000Z',
			saida_rubrica: PNG_1PX,
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
			entrada_rubrica: null,
			entrada_selfie_key: null,
			saida_timestamp: null,
			saida_rubrica: null,
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
	rubrica: PNG_1PX,
	verification_hash: 'golden-verification-hash',
	created_at: '2026-07-04T18:30:00.000Z'
};

// ─── Geradores sob teste ─────────────────────────────────────────────────────

const geradores: Record<string, () => Promise<Uint8Array>> = {
	fds: async () => gerarPdf(escalaFixture('fds'), policiaisFixture(), PNG_1PX).pdf,
	expediente: async () =>
		(
			await gerarPdfExpediente(
				escalaFixture('expediente'),
				policiaisFixture(),
				PNG_1PX_BYTES,
				PNG_1PX_BYTES,
				PNG_1PX
			)
		).pdf,
	plantao: async () => gerarPdfPlantao(escalaFixture('plantao'), policiaisFixture(), PNG_1PX).pdf,
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
				JPG_1PX_BYTES,
				PNG_1PX
			)
		).pdf,
	// Este é o GISE COMPLETO: além do timbre, traz `documento.rubrica`, que é o
	// outro desenho do PDF GISE sem cobertura (`gise` acima passa
	// `documento: null` e nem chega nele).
	gise_com_logos: async () => {
		const gise = giseDetalhadoFixture();
		(gise as unknown as { documento: unknown }).documento = { rubrica: PNG_1PX };
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
		).pdf
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
