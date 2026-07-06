import { createHash } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { FIXTURE } from './global-setup';
import { autenticarPagina, execD1Local } from './session';

/**
 * Cadastro/TROCA do e-mail pessoal pelo "Meu perfil":
 *  - a TROCA exige a senha de acesso (gate no servidor);
 *  - a confirmação por código OTP persiste o novo endereço verificado
 *    (desafio semeado no D1 com hash conhecido — e-mail real não sai no CI).
 */

const EMAIL_ANTIGO = 'antigo.fixture@teste.com';
const EMAIL_NOVO = 'novo.fixture@teste.com';
const CODIGO = '123456';

test.describe.configure({ mode: 'serial' });

test.beforeAll(() => {
	execD1Local(
		`UPDATE policiais SET email_pessoal='${EMAIL_ANTIGO}', email_pessoal_verificado=1 WHERE id=${FIXTURE.policialA.id};` +
			`DELETE FROM dois_fatores_tokens WHERE usuario_id=${FIXTURE.policialA.id} AND tipo='verificacao_email';`
	);
});

test.afterAll(() => {
	execD1Local(
		`UPDATE policiais SET email_pessoal=NULL, email_pessoal_verificado=0 WHERE id=${FIXTURE.policialA.id};` +
			`DELETE FROM dois_fatores_tokens WHERE usuario_id=${FIXTURE.policialA.id} AND tipo='verificacao_email';`
	);
});

test('troca exige senha: sem senha o envio fica bloqueado; senha errada é rejeitada', async ({
	page
}) => {
	const ok = await autenticarPagina(page, FIXTURE.policialA.id);
	if (!ok) test.skip(true, 'D1 indisponível');

	await page.goto('/perfil');
	await expect(page.getByText(EMAIL_ANTIGO)).toBeVisible();

	await page.getByRole('button', { name: 'Alterar', exact: true }).click();
	await expect(page.getByText('Trocar e-mail pessoal')).toBeVisible();

	const enviar = page.getByRole('button', { name: 'Enviar código' });
	await page.getByLabel('Novo e-mail pessoal').fill(EMAIL_NOVO);
	await expect(enviar).toBeDisabled(); // senha vazia bloqueia no cliente

	await page.getByLabel('Sua senha de acesso').fill('senha-completamente-errada');
	await enviar.click();
	await expect(page.getByText('Senha incorreta.')).toBeVisible();
});

test('confirmação por código OTP aplica a troca e marca como verificado', async ({ page }) => {
	const ok = await autenticarPagina(page, FIXTURE.policialA.id);
	if (!ok) test.skip(true, 'D1 indisponível');

	// Semeia o desafio como o endpoint `solicitar` faria (o hash do código
	// inclui o binding `tipo\x1femail`, igual ao servidor) — evita depender de
	// envio real de e-mail no runner.
	const desafioId = `e2e-desafio-${Date.now()}`;
	const bind = `policial\x1f${EMAIL_NOVO}`;
	const hash = createHash('sha256').update(`${bind}\x1f${CODIGO}`).digest('hex');
	const seeded = execD1Local(
		`INSERT INTO dois_fatores_tokens (desafio_id, tipo, usuario_id, codigo, expires_at) ` +
			`VALUES ('${desafioId}', 'verificacao_email', ${FIXTURE.policialA.id}, '${hash}', strftime('%Y-%m-%dT%H:%M:%S', 'now', '+10 minutes') || '.000Z');`
	);
	if (!seeded) test.skip(true, 'D1 indisponível');

	await page.goto('/perfil');
	// Confirma no contexto da página (cookies de sessão + CSRF double-submit).
	const resposta = await page.evaluate(
		async ({ desafioId, codigo, email }) => {
			const csrf =
				document.cookie
					.split('; ')
					.find((c) => c.startsWith('__csrf='))
					?.slice('__csrf='.length) ?? '';
			const res = await fetch('/api/auth/confirmar-verificacao-email-pessoal', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf },
				body: JSON.stringify({ desafioId, codigo, email })
			});
			return { status: res.status, json: await res.json().catch(() => ({})) };
		},
		{ desafioId, codigo: CODIGO, email: EMAIL_NOVO }
	);

	expect(resposta.status).toBe(200);
	expect((resposta.json as { ok?: boolean }).ok).toBe(true);

	await page.goto('/perfil');
	await expect(page.getByText(EMAIL_NOVO)).toBeVisible();
	await expect(page.getByText('Verificado', { exact: true })).toBeVisible();
});
