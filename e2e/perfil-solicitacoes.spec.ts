import { test, expect } from '@playwright/test';
import { FIXTURE } from './global-setup';
import { autenticarPagina, execD1Local } from './session';

/**
 * "Meu perfil" + aba "Solicitações" do Admin Geral: o policial solicita a
 * alteração de telefone, o admin aprova com um clique e o valor é aplicado
 * no cadastro.
 */

const ADMIN_TMP = 99003;
const NOVO_TELEFONE = '(85) 99999-0000';

test.describe.configure({ mode: 'serial' });

test.beforeAll(() => {
	execD1Local(
		`UPDATE policiais SET telefone=NULL WHERE id=${FIXTURE.policialA.id};` +
			`DELETE FROM cadastro_solicitacoes WHERE policial_id=${FIXTURE.policialA.id};` +
			`INSERT OR REPLACE INTO administradores (id, login, senha, nome, primeiro_acesso) VALUES (${ADMIN_TMP}, 'e2e-admin-solic', 'x', 'Admin Fixture Solic', 0);` +
			`DELETE FROM aceites_termos WHERE usuario_tipo='admin' AND usuario_id=${ADMIN_TMP};` +
			`INSERT INTO aceites_termos (usuario_tipo, usuario_id, versao_termo, hash_termo, aceitou_lgpd, aceitou_uso_email, aceitou_uso_localizacao) SELECT 'admin', ${ADMIN_TMP}, versao_termo, hash_termo, 1, 1, 1 FROM aceites_termos WHERE usuario_tipo='policial' LIMIT 1;`
	);
});

test.afterAll(() => {
	execD1Local(
		`UPDATE policiais SET telefone=NULL WHERE id=${FIXTURE.policialA.id};` +
			`DELETE FROM cadastro_solicitacoes WHERE policial_id=${FIXTURE.policialA.id};` +
			`DELETE FROM aceites_termos WHERE usuario_tipo='admin' AND usuario_id=${ADMIN_TMP};` +
			`DELETE FROM administradores WHERE id=${ADMIN_TMP};`
	);
});

test('policial solicita alteração de telefone no Meu perfil', async ({ page }) => {
	const ok = await autenticarPagina(page, FIXTURE.policialA.id);
	if (!ok) test.skip(true, 'D1 indisponível');

	await page.goto('/perfil');
	await expect(page.getByRole('heading', { name: 'Meu perfil' })).toBeVisible();
	// Identificação somente leitura
	await expect(page.getByText(FIXTURE.policialA.matricula)).toBeVisible();

	const botao = page.getByRole('button', { name: 'Solicitar alteração' });
	await expect(botao).toBeDisabled(); // sem mudanças ainda

	await page.getByLabel('Telefone').fill(NOVO_TELEFONE);
	await expect(botao).toBeEnabled();
	await botao.click();

	await expect(page.getByText('Solicitação enviada')).toBeVisible();
	await expect(page.getByText('Minhas solicitações')).toBeVisible();
	await expect(page.getByText('Pendente', { exact: true })).toBeVisible();
	await expect(page.getByText(NOVO_TELEFONE).first()).toBeVisible();
});

test('admin geral aprova na aba Solicitações e o cadastro é atualizado', async ({ page }) => {
	const ok = await autenticarPagina(page, ADMIN_TMP, 'admin');
	if (!ok) test.skip(true, 'D1 indisponível');

	await page.goto('/solicitacoes');
	await expect(page.getByRole('heading', { name: 'Solicitações' })).toBeVisible();
	await expect(page.getByText('Policial Fixture A')).toBeVisible();
	await expect(page.getByText(NOVO_TELEFONE)).toBeVisible();

	await page.getByRole('button', { name: /Aprovar solicitação de Policial Fixture A/ }).click();
	await expect(page.getByText('Alteração aprovada e aplicada')).toBeVisible();
	await expect(page.getByText('Nenhuma solicitação pendente.')).toBeVisible();
});

test('policial vê o telefone aplicado e a solicitação aprovada', async ({ page }) => {
	const ok = await autenticarPagina(page, FIXTURE.policialA.id);
	if (!ok) test.skip(true, 'D1 indisponível');

	await page.goto('/perfil');
	await expect(page.getByLabel('Telefone')).toHaveValue(NOVO_TELEFONE);
	await expect(page.getByText('Aprovada', { exact: true })).toBeVisible();
});
