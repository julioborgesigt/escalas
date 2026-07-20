import { test, expect } from '@playwright/test';
import { FIXTURE } from './global-setup';
import { seedSession, headersDeSessaoMutacao, cookieDeSessao } from './session';
import { assinarComoSerpro } from './ca-teste/assinador';

/**
 * Fluxo de assinatura QUALIFICADA por Token A3, de ponta a ponta e contra o
 * servidor real — antes só coberto pelo roteiro manual com hardware físico
 * (docs/QA_ASSINATURA_A3_DESKTOP.md).
 *
 * O runner faz o papel do Assinador SERPRO Desktop (e2e/ca-teste/assinador.ts):
 * recebe o PDF preparado, monta o CMS CAdES destacado e assina com o "e-CPF"
 * de teste emitido pela CA sintética que o build E2E injeta no trust store
 * (E2E_TEST_CA=1 — vide e2e/servidor-e2e.ts). O servidor executa a MESMA
 * verificação de produção: integridade do ByteRange, cobertura da assinatura,
 * RSA dos SignedAttributes, política criptográfica, CADEIA de certificação,
 * OCSP (sem AIA → 'unknown', aceito) e vínculo CPF token × sessão.
 *
 * O que fica de fora (segue no roteiro manual): o Assinador SERPRO em si
 * (WebSocket/PIN/token físico) e o carimbo ACT-ICP real.
 *
 * ⚠️ Local: se o preview reutilizado (reuseExistingServer) foi buildado SEM
 * E2E_TEST_CA=1, o teste feliz falha com 422 "não encadeia" — derrube o
 * servidor antigo e deixe o Playwright subir o e2e/servidor-e2e.ts.
 */

const ESCALA = FIXTURE.escalaAssinavelA3.id;

let token: string | null = null;

test.beforeAll(() => {
	token = seedSession(FIXTURE.policialA.id);
});

/** Executa o preparar e devolve o JSON (cada teste precisa do seu — o
 *  verificationHash é único por preparação). */
async function preparar(request: import('@playwright/test').APIRequestContext) {
	const res = await request.post(`/api/escalas/${ESCALA}/preparar-assinatura`, {
		headers: headersDeSessaoMutacao(token!),
		data: { signerName: FIXTURE.policialA.nome, signerCpf: FIXTURE.policialA.cpf }
	});
	expect(res.status(), await res.text().catch(() => '')).toBe(200);
	return (await res.json()) as {
		preparedPdf: string;
		messageDigest: string;
		signingTimeISO: string;
		verificationHash: string;
	};
}

function payloadFinalizar(prep: Awaited<ReturnType<typeof preparar>>, serproCms: string) {
	return {
		preparedPdf: prep.preparedPdf,
		serproCms,
		verificationHash: prep.verificationHash,
		signingTimeISO: prep.signingTimeISO,
		messageDigestHex: prep.messageDigest
	};
}

test.describe('Assinatura qualificada por Token A3 (CA de teste)', () => {
	test.skip(() => !token, 'D1 local indisponível — seed de sessão falhou');

	test('ciclo completo: preparar → assinar → finalizar → baixar → /validar', async ({
		request
	}) => {
		const prep = await preparar(request);

		// "SERPRO" do runner: CMS destacado assinado pelo e-CPF de teste.
		const serproCms = assinarComoSerpro(prep.preparedPdf, 'leaf');

		const fin = await request.post(`/api/escalas/${ESCALA}/finalizar-assinatura`, {
			headers: headersDeSessaoMutacao(token!),
			data: payloadFinalizar(prep, serproCms)
		});
		expect(fin.status(), await fin.text().catch(() => '')).toBe(200);

		// Documento persistido e baixável pelo dono da lotação.
		const doc = await request.get(`/api/escalas/${ESCALA}/documento-assinado`, {
			headers: cookieDeSessao(token!)
		});
		expect(doc.status()).toBe(200);
		expect(doc.headers()['content-type']).toContain('application/pdf');
		expect((await doc.body()).subarray(0, 5).toString()).toBe('%PDF-');

		// Validação pública (anônima): a página reconfere a criptografia e a
		// cadeia — com a raiz de teste no trust store, nada pode acusar falha.
		const val = await request.get(`/validar/${prep.verificationHash}`);
		expect(val.status()).toBe(200);
		const html = await val.text();
		expect(html).not.toContain('Cadeia ICP-Brasil inválida');
		expect(html).not.toContain('Assinatura RSA inválida');
	});

	test('certificado de CA desconhecida → 422 (cadeia continua sendo exigida)', async ({
		request
	}) => {
		const prep = await preparar(request);
		// Mesmo CN/CPF do titular, mas autoassinado: prova que injetar a raiz de
		// teste NÃO desligou a verificação de cadeia — só a raiz de teste é confiada.
		const serproCms = assinarComoSerpro(prep.preparedPdf, 'rogue');

		const fin = await request.post(`/api/escalas/${ESCALA}/finalizar-assinatura`, {
			headers: headersDeSessaoMutacao(token!),
			data: payloadFinalizar(prep, serproCms)
		});
		expect(fin.status()).toBe(422);
		expect((await fin.json()).error).toMatch(/não encadeia/i);
	});

	test('token de OUTRO titular → 400 (CPF do certificado × sessão)', async ({ request }) => {
		const prep = await preparar(request);
		// Cert VÁLIDO na cadeia de teste, porém de outro CPF: o finalizador deve
		// recusar antes de qualquer persistência.
		const serproCms = assinarComoSerpro(prep.preparedPdf, 'outro-cpf');

		const fin = await request.post(`/api/escalas/${ESCALA}/finalizar-assinatura`, {
			headers: headersDeSessaoMutacao(token!),
			data: payloadFinalizar(prep, serproCms)
		});
		expect(fin.status()).toBe(400);
		expect((await fin.json()).error).toMatch(/não pertence|CPF/i);
	});

	test('CMS adulterado (digest de outro conteúdo) → 422', async ({ request }) => {
		const prep1 = await preparar(request);
		const prep2 = await preparar(request);
		// Assina o PDF da preparação 1 e tenta finalizar o da preparação 2:
		// o messageDigest do CMS não confere com o ByteRange recebido.
		const serproCms = assinarComoSerpro(prep1.preparedPdf, 'leaf');

		const fin = await request.post(`/api/escalas/${ESCALA}/finalizar-assinatura`, {
			headers: headersDeSessaoMutacao(token!),
			data: payloadFinalizar(prep2, serproCms)
		});
		expect(fin.status()).toBe(422);
		expect((await fin.json()).error).toMatch(/messageDigest|não confere/i);
	});
});
