import { test, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { FIXTURE } from './global-setup';
import { seedSession, headersFormAction, cookieDeSessao, execD1Local } from './session';

/**
 * CRUD de escala pelas FORM ACTIONS (o fluxo real da UI /escalas e
 * /escalas/[id]) — antes sem cobertura E2E; as specs de assinatura só
 * consumiam escalas semeadas.
 *
 * Atores (sessões semeadas):
 *   - admin_unidade (fixture, lotação A): cria/edita/exclui escalas da sua
 *     unidade;
 *   - policial comum sem papel (fixture B, lotação B): negativos de RBAC;
 *   - policial A (lotação A): servidor adicionado à escala.
 *
 * Guardas exercitadas (achado B-2 da auditoria 2026-07-16 — POST direto):
 * criar/excluir exigem papel de administração; as actions de detalhe exigem
 * mesma lotação. Fixtures self-contained via SQL (ids 990xx), limpas por
 * marcador de título para reexecução local.
 */

const LOT_A = FIXTURE.unidadeA.nome;
const ALVO = 99060; // escala expediente da unidade A, alvo do "adicionar"
const DEL = 99061; // escala descartável, alvo do "excluir"
const TITULO = 'E2E-CRUD';

let tokenAdmin: string | null = null;
let tokenComum: string | null = null;

function seedEscala(id: number, dataInicio: string, dataFim: string, sufixo: string): boolean {
	return execD1Local(
		`INSERT OR REPLACE INTO escalas (id, titulo, cidade, tipo, lotacao, data_inicio, data_fim, hora_entrada, hora_saida) ` +
			`VALUES (${id}, '${TITULO} ${sufixo}', 'Fortaleza', 'expediente', '${LOT_A}', '${dataInicio}', '${dataFim}', '08', '08');`
	);
}

async function postForm(
	request: APIRequestContext,
	path: string,
	token: string,
	form: Record<string, string>
) {
	return request.post(path, { headers: headersFormAction(token), form });
}

test.beforeAll(() => {
	tokenAdmin = seedSession(FIXTURE.adminUnidade.id);
	tokenComum = seedSession(FIXTURE.policialB.id);
	// Alvo do "adicionar" (2026-09); começa sem servidores para re-runs locais.
	seedEscala(ALVO, '2026-09-01', '2026-09-30', 'Alvo');
	execD1Local(`DELETE FROM escala_policiais WHERE escala_id = ${ALVO};`);
});

test.afterAll(() => {
	if (tokenAdmin) execD1Local(`DELETE FROM escalas WHERE titulo LIKE '${TITULO}%';`);
});

test.describe('Criar escala (/escalas ?/criar)', () => {
	test.skip(() => !tokenAdmin || !tokenComum, 'D1 local indisponível');

	test('admin de unidade cria e a escala aparece na lista', async ({ request }) => {
		const res = await postForm(request, '/escalas?/criar', tokenAdmin!, {
			titulo: `${TITULO} Criar`,
			cidade: 'Fortaleza',
			data_inicio: '2026-10-01',
			data_fim: '2026-10-31',
			hora_entrada: '08',
			hora_saida: '18',
			tipo: 'expediente'
		});
		expect(res.status(), await res.text().catch(() => '')).toBe(200);
		expect(await res.text()).toContain('success');

		// Ponta a ponta: a listagem (HTML server-side, escopo da unidade) já a mostra.
		const lista = await request.get('/escalas', { headers: cookieDeSessao(tokenAdmin!) });
		expect(await lista.text()).toContain(`${TITULO} Criar`);
	});

	test('policial comum (sem papel) → 403', async ({ request }) => {
		const res = await postForm(request, '/escalas?/criar', tokenComum!, {
			titulo: `${TITULO} Proibido`,
			cidade: 'Fortaleza',
			data_inicio: '2026-10-01',
			data_fim: '2026-10-31',
			hora_entrada: '08',
			hora_saida: '18',
			tipo: 'expediente'
		});
		expect(await res.text()).toContain('Sem permissão');
	});

	test('unicidade: mesmo tipo/lotação/período → 409', async ({ request }) => {
		// Alvo dedicado (não depende do beforeAll nem de outros testes): expediente
		// unidade A, dezembro/2026 — mês isolado das demais escalas fixture.
		expect(seedEscala(99062, '2026-12-01', '2026-12-31', 'Unic')).toBe(true);
		const res = await postForm(request, '/escalas?/criar', tokenAdmin!, {
			titulo: `${TITULO} Duplicada`,
			cidade: 'Fortaleza',
			data_inicio: '2026-12-10',
			data_fim: '2026-12-20',
			hora_entrada: '08',
			hora_saida: '18',
			tipo: 'expediente'
		});
		const body = await res.text();
		// Diagnóstico no assert: se voltar a flakar, o status/body real aparece.
		expect(body, `status=${res.status()} body=${body}`).toMatch(/Já existe uma Escala/i);
	});
});

test.describe('Adicionar servidor (/escalas/[id] ?/adicionar)', () => {
	test.describe.configure({ mode: 'serial' });
	test.skip(() => !tokenAdmin || !tokenComum, 'D1 local indisponível');

	test('admin de unidade adiciona servidor → aparece na lista devolvida', async ({ request }) => {
		const res = await postForm(request, `/escalas/${ALVO}?/adicionar`, tokenAdmin!, {
			policial_id: String(FIXTURE.policialA.id),
			data_plantao: '2026-09-02',
			hora_entrada: '08',
			minuto_entrada: '00',
			hora_saida: '18',
			minuto_saida: '00'
		});
		expect(res.status(), await res.text().catch(() => '')).toBe(200);
		const body = await res.text();
		expect(body).toContain('success');
		expect(body).toContain(FIXTURE.policialA.matricula); // servidor na lista devolvida
	});

	test('mesmo servidor/data de novo → 409 (choque de horário global)', async ({ request }) => {
		const res = await postForm(request, `/escalas/${ALVO}?/adicionar`, tokenAdmin!, {
			policial_id: String(FIXTURE.policialA.id),
			data_plantao: '2026-09-02',
			hora_entrada: '08',
			minuto_entrada: '00',
			hora_saida: '18',
			minuto_saida: '00'
		});
		expect(await res.text()).toMatch(/choque|conflito|já/i);
	});

	test('policial de outra lotação → 403', async ({ request }) => {
		const res = await postForm(request, `/escalas/${ALVO}?/adicionar`, tokenComum!, {
			policial_id: String(FIXTURE.policialA.id),
			data_plantao: '2026-09-03',
			hora_entrada: '08',
			minuto_entrada: '00',
			hora_saida: '18',
			minuto_saida: '00'
		});
		expect(await res.text()).toMatch(/Sem permissão/i);
	});
});

test.describe('Excluir escala (/escalas ?/excluir)', () => {
	test.skip(() => !tokenAdmin || !tokenComum, 'D1 local indisponível');

	test('admin de unidade exclui a própria escala', async ({ request }) => {
		expect(seedEscala(DEL, '2026-11-01', '2026-11-30', 'Del')).toBe(true);
		const res = await postForm(request, '/escalas?/excluir', tokenAdmin!, {
			escala_id: String(DEL)
		});
		expect(res.status(), await res.text().catch(() => '')).toBe(200);
		expect(await res.text()).toContain('success');
	});

	test('policial comum (sem papel) → 403', async ({ request }) => {
		const res = await postForm(request, '/escalas?/excluir', tokenComum!, {
			escala_id: String(ALVO)
		});
		expect(await res.text()).toContain('Sem permissão');
	});
});
