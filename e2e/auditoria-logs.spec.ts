import { test, expect } from '@playwright/test';
import { FIXTURE } from './global-setup';
import { autenticarPagina, queryD1Local, tokenWebhookE2E } from './session';

/**
 * Console de logs técnicos (`/auditoria/logs`, Super Admin) — a ponta de
 * leitura do pipeline logger.warn/error → buffer da request → flush pós-
 * resposta → `app_log`. O teste central prova o pipeline INTEIRO: provoca um
 * warn real (webhook com bearer inválido), espera o flush aparecer no D1 e
 * então o console exibe o registro filtrado por busca.
 *
 * O redirect de quem NÃO é Super Admin já está coberto em
 * boas-vindas-rbac.spec.ts; aqui é o caminho positivo. Skip gracioso quando o
 * fixture não é Super Admin neste ambiente (SUPER_ADMIN_LOGIN próprio do dev).
 */

const MARCA = 'auth rejeitada';

test.describe('Console de logs técnicos', () => {
	test('captura um warn real e o exibe filtrado por busca', async ({ page, request }) => {
		const ok = await autenticarPagina(page, FIXTURE.superAdmin.id, 'admin');
		test.skip(!ok, 'D1 local indisponível');

		// Se o fixture não for Super Admin neste ambiente, o load redireciona.
		await page.goto('/auditoria/logs');
		test.skip(
			!page.url().includes('/auditoria/logs'),
			'fixture não é Super Admin neste ambiente (SUPER_ADMIN_LOGIN)'
		);
		await expect(page.getByRole('heading', { name: 'Logs técnicos' })).toBeVisible();

		// Provoca um logger.warn real no servidor (bearer inválido no webhook).
		const res = await request.post('/api/webhook/sync-policiais', {
			headers: { Authorization: 'Bearer token-invalido-para-gerar-warn-123456' },
			data: { matricula: 'X', nome: 'X', cargo: 'OIP' }
		});
		expect(res.status()).toBe(401);

		// O flush roda após a resposta — espera o registro chegar ao app_log.
		await expect
			.poll(
				() =>
					queryD1Local<{ n: number }>(
						`SELECT COUNT(*) as n FROM app_log WHERE message LIKE '%${MARCA}%'`
					)?.[0]?.n ?? 0,
				{ timeout: 15_000 }
			)
			.toBeGreaterThan(0);

		// O console exibe o registro, filtrado por busca livre.
		await page.goto(`/auditoria/logs?busca=${encodeURIComponent(MARCA)}`);
		await expect(page.getByText(MARCA).first()).toBeVisible();
	});
});
