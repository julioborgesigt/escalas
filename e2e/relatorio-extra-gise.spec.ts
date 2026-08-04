import { test, expect } from '@playwright/test';
import { FIXTURE } from './global-setup';
import { seedSession, headersDeSessaoMutacao, execD1Local } from './session';
import { assinarComoSerpro } from './ca-teste/assinador';

/**
 * Relatório Extraordinário da GISE (seccional) — assinatura QUALIFICADA do
 * supervisor, de ponta a ponta contra o servidor real. Antes só no roteiro
 * manual (docs QA A3 §5). Reusa a CA de teste: o supervisor fixture tem um
 * "e-CPF" próprio (SUPERVISOR_TESTE) emitido pela raiz de teste.
 *
 * Cobre as guardas do endpoint (quem assina, seccional válida, saída completa)
 * e o ciclo preparar → CMS → finalizar → persistência → /validar, incluindo o
 * negativo de CPF do token ≠ supervisor logado. A montagem do manifesto (todas
 * as rubricas de presença + supervisor) já é coberta no nível unitário por
 * manifesto-signers.test.ts (extração de texto do PDF); aqui garantimos que os
 * ENDPOINTS ligam tudo corretamente.
 *
 * Estado exigido: a seccional só é assinável quando TODOS os participantes
 * confirmaram a saída. Semeamos a presença do membro (entrada; depois saída
 * para o happy path) direto no D1 — os testes rodam em série nessa ordem.
 */

const GISE = FIXTURE.gise.id;
const SECCIONAL = FIXTURE.seccional.id; // route param = unidade id da seccional
const RUBRICA_PNG =
	'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

let tokenSupervisor: string | null = null;
let tokenMembro: string | null = null;

/** (Re)semeia a presença do membro: sempre com entrada; saída opcional. */
function seedPresencaMembro(comSaida: boolean): boolean {
	const colsSaida = comSaida ? `, saida_timestamp, saida_rubrica` : '';
	const valsSaida = comSaida ? `, '2026-06-01T16:00:00.000Z', '${RUBRICA_PNG}'` : '';
	return execD1Local(
		`DELETE FROM gise_presencas WHERE gise_id = ${GISE}; ` +
			`INSERT INTO gise_presencas (gise_id, policial_id, entrada_timestamp, entrada_rubrica${colsSaida}) ` +
			`VALUES (${GISE}, ${FIXTURE.membroGise.id}, '2026-06-01T08:00:00.000Z', '${RUBRICA_PNG}'${valsSaida});`
	);
}

const prepararUrl = (sec: number) => `/api/gise/${GISE}/relatorios/${sec}/preparar-assinatura`;
const finalizarUrl = (sec: number) => `/api/gise/${GISE}/relatorios/${sec}/finalizar-assinatura`;

type Prep = {
	intencao: string;
	preparedPdf: string;
	messageDigest: string;
	signingTimeISO: string;
	verificationHash: string;
};

async function preparar(request: import('@playwright/test').APIRequestContext) {
	const res = await request.post(prepararUrl(SECCIONAL), {
		headers: headersDeSessaoMutacao(tokenSupervisor!),
		data: { signerName: FIXTURE.supervisor.nome, signerCpf: FIXTURE.supervisor.cpf }
	});
	expect(res.status(), await res.text().catch(() => '')).toBe(200);
	return (await res.json()) as Prep;
}

function finalizarData(prep: Prep, serproCms: string) {
	return {
		intencao: prep.intencao,
		preparedPdf: prep.preparedPdf,
		serproCms,
		messageDigest: prep.messageDigest,
		signingTimeISO: prep.signingTimeISO
	};
}

test.beforeAll(() => {
	tokenSupervisor = seedSession(FIXTURE.supervisor.id);
	tokenMembro = seedSession(FIXTURE.membroGise.id);
	seedPresencaMembro(false); // estado inicial: entrada apenas (saída incompleta)
});

test.afterAll(() => {
	// Restaura o estado de presença para não afetar reexecuções locais.
	if (tokenSupervisor) execD1Local(`DELETE FROM gise_presencas WHERE gise_id = ${GISE};`);
});

test.describe('Relatório extraordinário GISE — assinatura qualificada', () => {
	test.describe.configure({ mode: 'serial' });
	test.skip(() => !tokenSupervisor || !tokenMembro, 'D1 local indisponível');

	test('membro comum (não supervisor/admin) → 403', async ({ request }) => {
		const res = await request.post(prepararUrl(SECCIONAL), {
			headers: headersDeSessaoMutacao(tokenMembro!),
			data: { signerName: FIXTURE.membroGise.nome, signerCpf: '' }
		});
		expect(res.status()).toBe(403);
		expect((await res.json()).error).toMatch(/supervisor designado|administradores/i);
	});

	test('seccional inexistente → 400', async ({ request }) => {
		const res = await request.post(prepararUrl(99999), {
			headers: headersDeSessaoMutacao(tokenSupervisor!),
			data: { signerName: FIXTURE.supervisor.nome, signerCpf: FIXTURE.supervisor.cpf }
		});
		expect(res.status()).toBe(400);
		expect((await res.json()).error).toMatch(/seccional inválida/i);
	});

	test('saída incompleta → 400 (relatório exige rubrica de todos)', async ({ request }) => {
		const res = await request.post(prepararUrl(SECCIONAL), {
			headers: headersDeSessaoMutacao(tokenSupervisor!),
			data: { signerName: FIXTURE.supervisor.nome, signerCpf: FIXTURE.supervisor.cpf }
		});
		expect(res.status()).toBe(400);
		expect((await res.json()).error).toMatch(/confirmar a saída/i);
	});

	test('supervisor: preparar → assinar (CA teste) → finalizar → /validar', async ({ request }) => {
		expect(seedPresencaMembro(true)).toBe(true); // completa a saída → assinável

		const prep = await preparar(request);
		const serproCms = assinarComoSerpro(prep.preparedPdf, 'supervisor');

		const fin = await request.post(finalizarUrl(SECCIONAL), {
			headers: headersDeSessaoMutacao(tokenSupervisor!),
			data: finalizarData(prep, serproCms)
		});
		expect(fin.status(), await fin.text().catch(() => '')).toBe(200);
		expect(fin.headers()['content-type']).toContain('application/pdf');
		expect((await fin.body()).subarray(0, 5).toString()).toBe('%PDF-');

		const val = await request.get(`/validar/${prep.verificationHash}`);
		expect(val.status()).toBe(200);
		const html = await val.text();
		expect(html).not.toContain('Cadeia ICP-Brasil inválida');
		expect(html).not.toContain('Assinatura RSA inválida');
	});

	test('token de outro titular no finalizar → 400 (CPF ≠ supervisor logado)', async ({
		request
	}) => {
		const prep = await preparar(request);
		// e-CPF do policial A (outro CPF), porém válido na cadeia de teste.
		const serproCms = assinarComoSerpro(prep.preparedPdf, 'leaf');
		const fin = await request.post(finalizarUrl(SECCIONAL), {
			headers: headersDeSessaoMutacao(tokenSupervisor!),
			data: finalizarData(prep, serproCms)
		});
		expect(fin.status()).toBe(400);
		expect((await fin.json()).error).toMatch(/não pertence|CPF/i);
	});
});
