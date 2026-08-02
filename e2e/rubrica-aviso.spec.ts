import { test, expect } from '@playwright/test';
import { FIXTURE } from './global-setup';
import { autenticarPagina } from './session';

/**
 * Aviso pós-login "Cadastre sua rubrica" (layout): aparece para policial SEM
 * rubrica com pendência concreta (membro/supervisor de GISE ativa ou DPC com
 * solicitação de assinatura), é adiável pela sessão e NÃO aparece para quem
 * não tem pendência.
 */

test.describe('Aviso de cadastro de rubrica', () => {
	test('membro de GISE ativa sem rubrica vê o aviso e pode adiar', async ({ page }) => {
		const ok = await autenticarPagina(page, FIXTURE.membroGise.id);
		if (!ok) test.skip(true, 'D1 indisponível');

		await page.goto('/bem-vindo');
		await expect(page.getByText('Cadastre sua rubrica')).toBeVisible();

		await page.getByRole('button', { name: 'Deixar para depois' }).click();
		await expect(page.getByText('Cadastre sua rubrica')).not.toBeVisible();

		// Adiado: navegar não traz o aviso de volta na mesma sessão do navegador.
		await page.goto('/res-gise');
		await expect(page.getByText('Cadastre sua rubrica')).not.toBeVisible();
	});

	test('botão "Cadastrar rubrica" abre o modal de cadastro', async ({ page }) => {
		const ok = await autenticarPagina(page, FIXTURE.supervisor.id);
		if (!ok) test.skip(true, 'D1 indisponível');

		await page.goto('/bem-vindo');
		await expect(page.getByText('Cadastre sua rubrica')).toBeVisible();
		await page.getByRole('button', { name: 'Cadastrar rubrica', exact: true }).click();
		// Modal de cadastro (abas desenhar/foto) assume o lugar do aviso. Locators
		// por role (não por texto literal): o rótulo da aba trocou de emoji para
		// ícone lucide (02a3e32) e o seletor antigo '✍️ Desenhar' quebrou.
		const dialog = page.getByRole('dialog', { name: 'Cadastrar Rubrica' });
		const tabDesenhar = page.getByRole('tab', { name: 'Desenhar' });
		await expect(dialog).toBeVisible();
		await expect(dialog.locator('..')).toHaveClass(/z-\[70\]/);
		await expect(tabDesenhar).toBeVisible();
		await expect(tabDesenhar).toBeFocused();
		await expect(page.getByRole('button', { name: 'Deixar para depois' })).not.toBeVisible();

		await page.keyboard.press('Escape');
		await expect(dialog).not.toBeVisible();
	});

	test('policial sem pendência de assinatura não vê o aviso', async ({ page }) => {
		const ok = await autenticarPagina(page, FIXTURE.policialB.id);
		if (!ok) test.skip(true, 'D1 indisponível');

		await page.goto('/bem-vindo');
		await expect(page.getByRole('button', { name: /Sair/ })).toBeVisible();
		await expect(page.getByText('Cadastre sua rubrica')).toHaveCount(0);
	});
});
