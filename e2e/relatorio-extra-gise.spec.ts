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
 * as presenças + supervisor) já é coberta no nível unitário por
 * manifesto-signers.test.ts (extração de texto do PDF); aqui garantimos que os
 * ENDPOINTS ligam tudo corretamente.
 *
 * Estado exigido: a seccional só é assinável quando TODOS os participantes
 * confirmaram a saída. Semeamos a presença do membro (entrada; depois saída
 * para o happy path) direto no D1 — os testes rodam em série nessa ordem.
 *
 * SEC-32: o UNIQUE em `(gise, seccional, tipo)` recusa o segundo INSERT. Este
 * spec e `relatorio-extra-avancado.spec.ts` compartilham a GISE fixture, então
 * o happy path apaga a linha vigente antes de assinar (o mesmo isolamento
 * que `escalaAssinavel` vs `escalaAssinavelA3` faz nas escalas).
 */

const GISE = FIXTURE.gise.id;
const SECCIONAL = FIXTURE.seccional.id; // route param = unidade id da seccional

let tokenSupervisor: string | null = null;
let tokenMembro: string | null = null;
let tokenAdminGeral: string | null = null;

/** (Re)semeia a presença do membro: sempre com entrada; saída opcional. */
function seedPresencaMembro(comSaida: boolean): boolean {
	const colsSaida = comSaida ? `, saida_timestamp` : '';
	const valsSaida = comSaida ? `, '2026-06-01T16:00:00.000Z'` : '';
	return execD1Local(
		`DELETE FROM gise_presencas WHERE gise_id = ${GISE}; ` +
			`INSERT INTO gise_presencas (gise_id, policial_id, entrada_timestamp${colsSaida}) ` +
			`VALUES (${GISE}, ${FIXTURE.membroGise.id}, '2026-06-01T08:00:00.000Z'${valsSaida});`
	);
}

/** Revoga o extra desta seccional — o unique não admite overwrite (SEC-32). */
function limparAssinaturaExtra(): boolean {
	return execD1Local(
		`DELETE FROM gise_assinaturas_relatorios WHERE gise_id = ${GISE} AND seccional_id = ${SECCIONAL} AND tipo = 'extraordinario'`
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
	tokenAdminGeral = seedSession(FIXTURE.adminGeral.id, 'admin');
	seedPresencaMembro(false); // estado inicial: entrada apenas (saída incompleta)
});

test.afterAll(() => {
	// Restaura o estado de presença e a assinatura do extra para não afetar
	// reexecuções locais nem o spec avançado que compartilha a fixture.
	if (tokenSupervisor) {
		execD1Local(
			`DELETE FROM gise_presencas WHERE gise_id = ${GISE}; ` +
				`DELETE FROM gise_assinaturas_relatorios WHERE gise_id = ${GISE} AND seccional_id = ${SECCIONAL} AND tipo = 'extraordinario'`
		);
	}
});

test.describe('Relatório extraordinário GISE — assinatura qualificada', () => {
	test.describe.configure({ mode: 'serial' });
	test.skip(() => !tokenSupervisor || !tokenMembro || !tokenAdminGeral, 'D1 local indisponível');

	test('membro comum (não é o supervisor designado) → 403', async ({ request }) => {
		const res = await request.post(prepararUrl(SECCIONAL), {
			headers: headersDeSessaoMutacao(tokenMembro!),
			data: { signerName: FIXTURE.membroGise.nome, signerCpf: '' }
		});
		expect(res.status()).toBe(403);
		expect((await res.json()).error).toMatch(/supervisor designado/i);
	});

	/**
	 * O Admin Geral NÃO assina o relatório extraordinário — em nenhuma das cinco
	 * rotas da família.
	 *
	 * Até ago/2026 as cinco aceitavam `u.tipo === 'admin'`, e nenhuma tela jamais
	 * ofereceu isso: `isSupervisor` é `false` para admin já no `load`, e os dois
	 * pontos de entrada da assinatura estão atrás dele. O que decidiu a remoção
	 * não foi a tela e sim o documento: a sessão de admin não tem `cpf` nem
	 * `matrícula` (`mapearAdmin`), então o relatório sairia com matrícula `null`
	 * e com o CPF que o cliente mandasse — a única afirmação de identidade que
	 * ninguém verificaria, num documento com valor jurídico.
	 *
	 * As CINCO juntas de propósito: apertar só algumas recria a divergência que
	 * a extração do portão da escala GISE veio desfazer. Se uma voltar a aceitar
	 * admin, é aqui que aparece.
	 */
	test('Admin Geral → 403 nas cinco rotas de assinatura do extra', async ({ request }) => {
		const base = `/api/gise/${GISE}/relatorios/${SECCIONAL}`;
		const rotas = [
			`${base}/assinar`,
			`${base}/preparar-assinatura`,
			`${base}/finalizar-assinatura`,
			`${base}/preparar-assinatura-avancada`,
			`${base}/finalizar-assinatura-avancada`
		];

		for (const url of rotas) {
			const res = await request.post(url, {
				headers: headersDeSessaoMutacao(tokenAdminGeral!),
				data: { signerName: 'Qualquer Nome', signerCpf: '11144477735' }
			});
			expect(res.status(), `${url} devia recusar Admin Geral`).toBe(403);
			expect((await res.json()).error, url).toMatch(/supervisor designado/i);
		}
	});

	test('seccional inexistente → 400', async ({ request }) => {
		const res = await request.post(prepararUrl(99999), {
			headers: headersDeSessaoMutacao(tokenSupervisor!),
			data: { signerName: FIXTURE.supervisor.nome, signerCpf: FIXTURE.supervisor.cpf }
		});
		expect(res.status()).toBe(400);
		expect((await res.json()).error).toMatch(/seccional inválida/i);
	});

	test('saída incompleta → 400 (relatório exige a saída de todos)', async ({ request }) => {
		const res = await request.post(prepararUrl(SECCIONAL), {
			headers: headersDeSessaoMutacao(tokenSupervisor!),
			data: { signerName: FIXTURE.supervisor.nome, signerCpf: FIXTURE.supervisor.cpf }
		});
		expect(res.status()).toBe(400);
		expect((await res.json()).error).toMatch(/confirmar a saída/i);
	});

	test('supervisor: preparar → assinar (CA teste) → finalizar → /validar', async ({ request }) => {
		expect(seedPresencaMembro(true)).toBe(true); // completa a saída → assinável
		expect(limparAssinaturaExtra()).toBe(true);

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

	test('reassinar sem revogar → 409 (SEC-32)', async ({ request }) => {
		const prep = await preparar(request);
		const serproCms = assinarComoSerpro(prep.preparedPdf, 'supervisor');
		const fin = await request.post(finalizarUrl(SECCIONAL), {
			headers: headersDeSessaoMutacao(tokenSupervisor!),
			data: finalizarData(prep, serproCms)
		});
		expect(fin.status()).toBe(409);
		expect((await fin.json()).error).toMatch(/revogue/i);
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
