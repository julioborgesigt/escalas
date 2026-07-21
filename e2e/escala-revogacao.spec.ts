import { test, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { FIXTURE } from './global-setup';
import { seedSession, headersDeSessaoMutacao, cookieDeSessao, execD1Local } from './session';
import { assinarComoSerpro } from './ca-teste/assinador';

/**
 * Ciclo de vida da assinatura de escala: assinar → baixar → revogar →
 * reassinar. Exercita o caminho de revogação (DELETE documento-assinado →
 * limparR2DocumentoEscala + excluirDocumentoEscala) e a re-assinatura sobre
 * um documento anterior (finalizar → limparR2ObsoletoEscala, achado R2-4).
 *
 * A correção da limpeza de R2 em si (quais objetos apagar) é coberta no
 * unitário r2-cleanup.test.ts; aqui garantimos o comportamento OBSERVÁVEL do
 * ciclo (documento some do banco e do /validar; reassinatura funciona) e as
 * guardas de permissão. Assina via CA de teste (policial A tem o e-CPF 'leaf').
 */

const ESCALA = 99004; // dedicada deste spec (plantão, unidade A)
const NAO_ENCONTRADO = 'não corresponde a nenhum documento';

let token: string | null = null;
let tokenForasteiro: string | null = null;

function seedEscalaAssinavel(): boolean {
	return execD1Local(
		`INSERT OR REPLACE INTO escalas (id, titulo, cidade, tipo, lotacao, data_inicio, data_fim, hora_entrada, hora_saida) ` +
			`VALUES (${ESCALA}, 'E2E Revogação', 'Fortaleza', 'plantao', '${FIXTURE.unidadeA.nome}', '2026-08-01', '2026-08-31', '08', '20'); ` +
			`DELETE FROM escala_policiais WHERE escala_id = ${ESCALA}; ` +
			`INSERT INTO escala_policiais (escala_id, policial_id, data_plantao, hora_entrada, hora_saida, equipe) ` +
			`VALUES (${ESCALA}, ${FIXTURE.policialA.id}, '2026-08-01', '08:00', '20:00', '1'); ` +
			`DELETE FROM escala_documentos WHERE escala_id = ${ESCALA};`
	);
}

/** preparar → assinar (CA teste) → finalizar; devolve o verificationHash. */
async function assinarEscala(request: APIRequestContext): Promise<string> {
	const prep = await request.post(`/api/escalas/${ESCALA}/preparar-assinatura`, {
		headers: headersDeSessaoMutacao(token!),
		data: { signerName: FIXTURE.policialA.nome, signerCpf: FIXTURE.policialA.cpf }
	});
	expect(prep.status(), await prep.text().catch(() => '')).toBe(200);
	const p = (await prep.json()) as {
		preparedPdf: string;
		messageDigest: string;
		signingTimeISO: string;
		verificationHash: string;
	};
	const serproCms = assinarComoSerpro(p.preparedPdf, 'leaf');
	const fin = await request.post(`/api/escalas/${ESCALA}/finalizar-assinatura`, {
		headers: headersDeSessaoMutacao(token!),
		data: {
			preparedPdf: p.preparedPdf,
			serproCms,
			verificationHash: p.verificationHash,
			signingTimeISO: p.signingTimeISO,
			messageDigestHex: p.messageDigest
		}
	});
	expect(fin.status(), await fin.text().catch(() => '')).toBe(200);
	return p.verificationHash;
}

const baixarDoc = (request: APIRequestContext) =>
	request.get(`/api/escalas/${ESCALA}/documento-assinado`, { headers: cookieDeSessao(token!) });

test.beforeAll(() => {
	token = seedSession(FIXTURE.policialA.id);
	tokenForasteiro = seedSession(FIXTURE.policialB.id);
	seedEscalaAssinavel();
});

test.afterAll(() => {
	if (token) execD1Local(`DELETE FROM escalas WHERE id = ${ESCALA};`);
});

test.describe('Escala — ciclo assinar/revogar/reassinar', () => {
	test.describe.configure({ mode: 'serial' });
	test.skip(() => !token || !tokenForasteiro, 'D1 local indisponível');

	let hashAtual = '';

	test('assinar → documento baixável e /validar encontra', async ({ request }) => {
		hashAtual = await assinarEscala(request);

		const doc = await baixarDoc(request);
		expect(doc.status()).toBe(200);
		expect((await doc.body()).subarray(0, 5).toString()).toBe('%PDF-');

		const val = await request.get(`/validar/${hashAtual}`);
		expect(val.status()).toBe(200);
		expect(await val.text()).not.toContain(NAO_ENCONTRADO);
	});

	test('revogar → documento some do banco e do /validar', async ({ request }) => {
		const hashRevogado = hashAtual;
		const del = await request.delete(`/api/escalas/${ESCALA}/documento-assinado`, {
			headers: headersDeSessaoMutacao(token!)
		});
		expect(del.status(), await del.text().catch(() => '')).toBe(200);

		// Linha do documento removida: download 404 e /validar não encontra mais.
		expect((await baixarDoc(request)).status()).toBe(404);
		const val = await request.get(`/validar/${hashRevogado}`);
		expect(await val.text()).toContain(NAO_ENCONTRADO);
	});

	test('reassinar após revogar → novo documento, novo hash', async ({ request }) => {
		const novoHash = await assinarEscala(request);
		expect(novoHash).not.toBe(hashAtual);
		hashAtual = novoHash;

		expect((await baixarDoc(request)).status()).toBe(200);
		const val = await request.get(`/validar/${novoHash}`);
		expect(await val.text()).not.toContain(NAO_ENCONTRADO);
	});

	test('re-assinatura sem revogar (overwrite R2-4) → substitui o documento', async ({
		request
	}) => {
		const hashAntigo = hashAtual;
		const novoHash = await assinarEscala(request);
		expect(novoHash).not.toBe(hashAntigo);

		// O documento atual é o novo; o hash antigo não resolve mais.
		expect((await baixarDoc(request)).status()).toBe(200);
		expect(await (await request.get(`/validar/${novoHash}`)).text()).not.toContain(NAO_ENCONTRADO);
		expect(await (await request.get(`/validar/${hashAntigo}`)).text()).toContain(NAO_ENCONTRADO);
	});

	test('policial de outra lotação não revoga → 403', async ({ request }) => {
		const del = await request.delete(`/api/escalas/${ESCALA}/documento-assinado`, {
			headers: headersDeSessaoMutacao(tokenForasteiro!)
		});
		expect(del.status()).toBe(403);
	});
});
