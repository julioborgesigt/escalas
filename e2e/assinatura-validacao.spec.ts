import { test, expect } from '@playwright/test';
import { FIXTURE } from './global-setup';
import { autenticarPagina } from './session';

/**
 * E2E do lado de VERIFICAÇÃO do ciclo de assinatura: a página pública
 * `/validar/[hash]` e o gating do download do PDF assinado.
 *
 * Regressão das mudanças recentes de segurança/LGPD:
 *  - O download do PDF íntegro (que contém o manifesto forense: CPF/IP/GPS/
 *    selfie) passou a exigir sessão — `/api/validar/[hash]/download` devolve 401
 *    para anônimo.
 *  - A página pública prova só a AUTENTICIDADE; visitante anônimo vê um aviso de
 *    login no lugar do botão de download, e o usuário autenticado vê o botão.
 *
 * Usa o documento assinado semeado pelo global-setup (escala_documentos com
 * `verificacao_hash`). O ato de ASSINAR em si (SignaturePad/face-api/Token A3)
 * depende de câmera/GPS/hardware e não roda em CI — aqui cobrimos a verificação.
 *
 * Se o fixture não foi semeado (D1 local indisponível), os testes pulam via
 * `test.skip()`, como nos demais specs.
 */

const HASH = `fixture-hash-${FIXTURE.escalaA.id}`;

test.describe('Validação pública + gating do download', () => {
	test('anônimo: documento encontrado, mas download exige login (aviso, sem botão)', async ({
		page
	}) => {
		await page.goto(`/validar/${HASH}`);
		const naoEncontrado = await page
			.locator('text=/não encontrado/i')
			.first()
			.isVisible()
			.catch(() => false);
		if (naoEncontrado) test.skip(true, 'Fixture não semeada (D1 local indisponível)');

		// Documento foi localizado pelo hash (prova de autenticidade renderizada).
		await expect(page.locator('text=/Assinado Digitalmente por/i').first()).toBeVisible();
		// Gating: aviso de login no lugar do botão de download.
		await expect(page.locator('text=/Faça login para baixar/i').first()).toBeVisible();
		await expect(page.locator('text=/Baixar Documento Assinado/i')).toHaveCount(0);
	});

	test('anônimo: GET do PDF assinado retorna 401 (auth_required)', async ({ request }) => {
		const res = await request.get(`/api/validar/${HASH}/download`);
		expect(res.status()).toBe(401);
		const body = await res.json();
		expect(body.errorType).toBe('auth_required');
	});

	test('autenticado: vê o botão de download (sem aviso de login)', async ({ page }) => {
		// Sessão semeada (e2e/session.ts) — o login por senha da conta fixture é
		// bloqueado pelo 2FA fail-closed (sem e-mail cadastrado).
		const ok = await autenticarPagina(page, FIXTURE.policialA.id);
		if (!ok) test.skip(true, 'wrangler/D1 local indisponível');

		await page.goto(`/validar/${HASH}`);
		const naoEncontrado = await page
			.locator('text=/não encontrado/i')
			.first()
			.isVisible()
			.catch(() => false);
		if (naoEncontrado) test.skip(true, 'Fixture não semeada');

		await expect(page.locator('text=/Baixar Documento Assinado/i').first()).toBeVisible();
		await expect(page.locator('text=/Faça login para baixar/i')).toHaveCount(0);
	});
});
