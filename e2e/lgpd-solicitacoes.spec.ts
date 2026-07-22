import { test, expect } from '@playwright/test';
import { FIXTURE } from './global-setup';
import { seedSession, cookieDeSessao, headersDeSessaoMutacao, execD1Local } from './session';

/**
 * Direitos do titular (LGPD art. 18) de ponta a ponta — obrigação legal, antes
 * sem cobertura de integração. Ciclo completo: o titular abre a solicitação, o
 * Admin Geral lista/detalha e responde, e o titular vê o desfecho; reencerrar
 * uma solicitação já concluída é conflito.
 *
 * RBAC: `/api/lgpd/solicitar` é de qualquer autenticado (o titular); os
 * endpoints `/api/admin/lgpd/*` exigem Admin Geral.
 */

let tokenTitular: string | null = null;
let tokenAdmin: string | null = null;
let solicitacaoId = 0;

const limpar = () =>
	execD1Local(
		`DELETE FROM lgpd_solicitacoes WHERE solicitante_tipo='policial' AND solicitante_id=${FIXTURE.policialA.id};`
	);

test.beforeAll(() => {
	tokenTitular = seedSession(FIXTURE.policialA.id, 'policial');
	tokenAdmin = seedSession(FIXTURE.adminGeral.id, 'admin');
	limpar();
});

test.afterAll(() => {
	if (tokenTitular) limpar();
});

test.describe('LGPD — direitos do titular (art. 18)', () => {
	test.describe.configure({ mode: 'serial' });
	test.skip(() => !tokenTitular || !tokenAdmin, 'D1 local indisponível');

	test('titular abre solicitação de acesso → 201 e aparece na sua lista', async ({ request }) => {
		const criar = await request.post('/api/lgpd/solicitar', {
			headers: headersDeSessaoMutacao(tokenTitular!),
			data: { tipo_direito: 'acesso', descricao: 'E2E: solicito cópia dos meus dados' }
		});
		expect(criar.status(), await criar.text().catch(() => '')).toBe(201);
		const body = await criar.json();
		expect(body.ok).toBe(true);
		expect(body.solicitacao?.tipo_direito).toBe('acesso');
		solicitacaoId = body.solicitacao.id;
		expect(solicitacaoId).toBeGreaterThan(0);

		const minhas = await request.get('/api/lgpd/solicitar', {
			headers: cookieDeSessao(tokenTitular!)
		});
		expect(minhas.status()).toBe(200);
		const lista = (await minhas.json()).solicitacoes as Array<{ id: number; status: string }>;
		expect(lista.some((s) => s.id === solicitacaoId)).toBe(true);
	});

	test('titular não acessa a lista administrativa → 403', async ({ request }) => {
		const res = await request.get('/api/admin/lgpd/solicitacoes', {
			headers: cookieDeSessao(tokenTitular!)
		});
		expect(res.status()).toBe(403);
	});

	test('Admin Geral lista e vê o detalhe da solicitação', async ({ request }) => {
		const lista = await request.get('/api/admin/lgpd/solicitacoes', {
			headers: cookieDeSessao(tokenAdmin!)
		});
		expect(lista.status()).toBe(200);
		const solicitacoes = (await lista.json()).solicitacoes as Array<{ id: number }>;
		expect(solicitacoes.some((s) => s.id === solicitacaoId)).toBe(true);

		const detalhe = await request.get(`/api/admin/lgpd/solicitacoes/${solicitacaoId}`, {
			headers: cookieDeSessao(tokenAdmin!)
		});
		expect(detalhe.status()).toBe(200);
		expect((await detalhe.json()).solicitacao.id).toBe(solicitacaoId);
	});

	test('Admin responde (conclui) e o titular vê o desfecho', async ({ request }) => {
		const patch = await request.patch(`/api/admin/lgpd/solicitacoes/${solicitacaoId}`, {
			headers: headersDeSessaoMutacao(tokenAdmin!),
			data: { status: 'concluida', resposta: 'E2E: dados fornecidos por e-mail seguro.' }
		});
		expect(patch.status(), await patch.text().catch(() => '')).toBe(200);
		expect((await patch.json()).solicitacao.status).toBe('concluida');

		// O titular enxerga o status e a resposta na sua própria lista.
		const minhas = await request.get('/api/lgpd/solicitar', {
			headers: cookieDeSessao(tokenTitular!)
		});
		const alvo = ((await minhas.json()).solicitacoes as Array<{ id: number; status: string }>).find(
			(s) => s.id === solicitacaoId
		);
		expect(alvo?.status).toBe('concluida');
	});

	test('responder uma solicitação já encerrada → 409', async ({ request }) => {
		const patch = await request.patch(`/api/admin/lgpd/solicitacoes/${solicitacaoId}`, {
			headers: headersDeSessaoMutacao(tokenAdmin!),
			data: { status: 'indeferida', resposta: 'E2E: tentativa de reencerrar.' }
		});
		expect(patch.status()).toBe(409);
		expect((await patch.json()).error).toMatch(/já encerrada/i);
	});
});
