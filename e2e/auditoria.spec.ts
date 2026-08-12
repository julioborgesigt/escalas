import { test, expect, request as pwRequest } from '@playwright/test';
import { FIXTURE } from './global-setup';
import {
	seedSession,
	cookieDeSessao,
	tokenWebhookE2E,
	execD1Local,
	BASE_URL,
	headersWebhookE2E
} from './session';

/**
 * Console de auditoria (Super Admin). Os NEGATIVOS de RBAC (anônimo 401,
 * policial/Admin Geral 403) já estão em boas-vindas-rbac; aqui cobrimos o
 * caminho POSITIVO do Super Admin e a integração da trilha forense:
 *   - consulta `/api/admin/audit` (paginada);
 *   - a trilha CAPTURA eventos ponta a ponta (um webhook sync gera
 *     `sync_policiais`, recuperável filtrado por ação);
 *   - export CSV com content-type correto e limite de janela (400).
 *
 * A cadeia de hash/canonicalização em si tem cobertura unitária
 * (audit-forense.test.ts); aqui garantimos a ligação rota → audit_log → API.
 *
 * Super Admin depende de SUPER_ADMIN_LOGIN == login do admin fixture. Quando o
 * dev tem o seu próprio SUPER_ADMIN_LOGIN, a sessão do fixture não vira super
 * admin e o /api/admin/audit responde 403 — os testes pulam nesse caso.
 */

const SYNC = tokenWebhookE2E();
const MAT_AUDIT = 'AUDITE2E01';

let token: string | null = null;
let ehSuperAdmin = false;

test.beforeAll(async () => {
	token = seedSession(FIXTURE.superAdmin.id, 'admin');
	if (!token) return;
	// `request` é test-scoped; no beforeAll criamos um contexto próprio para
	// confirmar que a sessão é realmente Super Admin neste ambiente.
	const ctx = await pwRequest.newContext({ baseURL: BASE_URL });
	const probe = await ctx.get('/api/admin/audit?limit=1', { headers: cookieDeSessao(token) });
	ehSuperAdmin = probe.status() === 200;
	await ctx.dispose();
});

test.afterAll(() => {
	execD1Local(`DELETE FROM policiais WHERE matricula = '${MAT_AUDIT}';`);
});

test.describe('Console de auditoria (Super Admin)', () => {
	test.skip(() => !token || !ehSuperAdmin, 'Super Admin fixture indisponível (SUPER_ADMIN_LOGIN)');

	test('lista eventos paginados', async ({ request }) => {
		const res = await request.get('/api/admin/audit?page=1&limit=10', {
			headers: cookieDeSessao(token!)
		});
		expect(res.status()).toBe(200);
		const body = await res.json();
		expect(Array.isArray(body.logs)).toBe(true);
		expect(typeof body.total).toBe('number');
		expect(body.limit).toBe(10);
	});

	test('a trilha captura um evento de webhook (sync_policiais) recuperável por ação', async ({
		request
	}) => {
		test.skip(!SYNC, 'SYNC_TOKEN indisponível');

		// Dispara uma ação auditável (o webhook audita `sync_policiais`).
		const sync = await request.post('/api/webhook/sync-policiais', {
			headers: headersWebhookE2E(SYNC!),
			data: {
				matricula: MAT_AUDIT,
				nome: 'Auditoria Webhook',
				cargo: 'OIP',
				lotacao: 'DELEGACIA E2E FIXTURE A'
			}
		});
		expect(sync.status()).toBe(200);

		// O evento aparece no console filtrado por ação.
		const res = await request.get('/api/admin/audit?acao=sync_policiais&limit=5', {
			headers: cookieDeSessao(token!)
		});
		expect(res.status()).toBe(200);
		const body = await res.json();
		expect(body.total).toBeGreaterThan(0);
		expect(body.logs.every((l: { acao: string }) => l.acao === 'sync_policiais')).toBe(true);
	});

	test('export CSV → 200 text/csv com cabeçalho', async ({ request }) => {
		const res = await request.get('/auditoria/export?format=csv', {
			headers: cookieDeSessao(token!)
		});
		expect(res.status()).toBe(200);
		expect(res.headers()['content-type']).toContain('text/csv');
		expect(res.headers()['content-disposition']).toMatch(/auditoria-.*\.csv/);
		// Cabeçalho do CSV presente (montarCsv escreve os nomes das colunas).
		expect((await res.text()).length).toBeGreaterThan(0);
	});

	test('export com janela longa demais → 400', async ({ request }) => {
		// CSV aceita no máximo 366 dias; 2 anos deve ser recusado.
		const res = await request.get('/auditoria/export?format=csv&de=2024-01-01&ate=2026-01-01', {
			headers: cookieDeSessao(token!)
		});
		expect(res.status()).toBe(400);
		expect((await res.json()).error).toMatch(/período muito longo|máximo/i);
	});
});
