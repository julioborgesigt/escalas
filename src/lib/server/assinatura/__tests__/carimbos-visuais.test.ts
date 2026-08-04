/**
 * GOLDENS dos carimbos visuais de assinatura.
 *
 * `pdf-goldens` cobre os geradores de `export/pdf.ts` — as ESCALAS. Não cobre
 * estes três desenhos, que são o que o leitor de um PDF **assinado** vê: o
 * rodapé simples, o rodapé universal e a página de auditoria. Ficaram sem rede
 * até ago/2026, e é justamente aqui que mora o texto de base legal e o QR de
 * validação: mudar um byte por engano altera um documento com valor jurídico.
 *
 * O harness parte de um PDF mínimo montado no próprio teste (não de fixture em
 * disco) para que o golden dependa só do código de carimbo, e congela `Date`
 * porque os três desenham data/hora.
 *
 * Para regravar após uma mudança visual INTENCIONAL:
 *   UPDATE_PDF_GOLDENS=1 npx vitest run carimbos-visuais
 * e confira o PDF despejado em `$TMPDIR/escalas-carimbos` antes de commitar.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import {
	adicionarRodapeSimples,
	adicionarRodapeUniversal,
	adicionarPaginaAuditoria
} from '../pdf-signing-visual';

const GOLDENS_PATH = join(
	dirname(fileURLToPath(import.meta.url)),
	'fixtures',
	'carimbos-visuais.json'
);
const UPDATE = process.env.UPDATE_PDF_GOLDENS === '1';
const FUSO_ORIGINAL = process.env.TZ;

const URL_VALIDACAO = 'https://escalas.pages.dev/validar/ABC123';
const HASH = 'a'.repeat(64);

/** PDF de uma página, sem nada além de um título — o suporte dos carimbos. */
async function pdfBase(): Promise<Uint8Array> {
	const doc = await PDFDocument.create();
	// Sem isto o pdf-lib grava a data corrente nos metadados e o golden oscila.
	doc.setCreationDate(new Date('2026-07-01T12:00:00.000Z'));
	doc.setModificationDate(new Date('2026-07-01T12:00:00.000Z'));
	const page = doc.addPage([595, 842]); // A4 retrato, em pontos
	const font = await doc.embedFont(StandardFonts.Helvetica);
	page.drawText('ESCALA DE TESTE', { x: 60, y: 780, size: 14, font });
	return doc.save();
}

const carimbos: Record<string, () => Promise<Uint8Array>> = {
	rodape_simples: async () =>
		adicionarRodapeSimples(await pdfBase(), 'FULANO DE TAL', {
			verificationHash: HASH,
			verificationUrl: URL_VALIDACAO,
			ip: '203.0.113.7',
			latitude: -7.21,
			longitude: -39.31,
			signatureLevel: 'avancada'
		}),
	rodape_universal: async () =>
		adicionarRodapeUniversal(await pdfBase(), {
			// `signerName` é o que ativa o bloco de identidade com QR na última
			// página — sem ele o rodapé sai só com hash e base legal, e o carimbo
			// que este golden existe para travar não chega a ser desenhado.
			signerName: 'FULANO DE TAL',
			signerMatricula: '301.095-1-1',
			documentHash: HASH,
			verificationHash: 'B48T-4N22',
			verificationUrl: URL_VALIDACAO,
			signedAtISO: '2026-07-01T12:00:00.000Z'
		}),
	pagina_auditoria: async () =>
		adicionarPaginaAuditoria(await pdfBase(), {
			signerName: 'FULANO DE TAL',
			signerCpf: '12345678901',
			// Obrigatório e sem default: `Intl.DateTimeFormat().format(undefined)`
			// formata a hora CORRENTE do relógio nativo — que `vi.setSystemTime`
			// não intercepta —, então esquecê-lo torna o golden instável.
			signingTime: new Date('2026-07-01T12:00:00.000Z'),
			verificationHash: HASH,
			verificationUrl: URL_VALIDACAO,
			ip: '203.0.113.7',
			userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0.0.0 Safari/537.36',
			latitude: -7.21,
			longitude: -39.31,
			signatureLevel: 'qualificada'
		})
};

describe('carimbos visuais de assinatura (goldens)', () => {
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

	const goldens: Record<string, { sha256: string; bytes: number }> = existsSync(GOLDENS_PATH)
		? JSON.parse(readFileSync(GOLDENS_PATH, 'utf8'))
		: {};
	const atualizados: Record<string, { sha256: string; bytes: number }> = {};

	for (const [nome, gerar] of Object.entries(carimbos)) {
		it(`${nome}: determinístico e igual ao golden`, async () => {
			const a = await gerar();
			const b = await gerar();
			const sha = createHash('sha256').update(a).digest('hex');
			expect(createHash('sha256').update(b).digest('hex'), `${nome}: não-determinístico`).toBe(sha);

			atualizados[nome] = { sha256: sha, bytes: a.length };
			if (UPDATE) {
				const dir = join(tmpdir(), 'escalas-carimbos');
				mkdirSync(dir, { recursive: true });
				writeFileSync(join(dir, `${nome}.pdf`), a);
				return;
			}

			expect(
				goldens[nome],
				`golden ausente para '${nome}' — rode UPDATE_PDF_GOLDENS=1 npx vitest run carimbos-visuais`
			).toBeDefined();
			expect(sha).toBe(goldens[nome].sha256);
		});
	}

	afterAll(() => {
		if (UPDATE) {
			mkdirSync(dirname(GOLDENS_PATH), { recursive: true });
			writeFileSync(GOLDENS_PATH, JSON.stringify(atualizados, null, '\t') + '\n');
		}
	});
});
