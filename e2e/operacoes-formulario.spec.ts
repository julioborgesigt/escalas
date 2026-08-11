import { test, expect } from '@playwright/test';
import { FIXTURE } from './global-setup';
import { autenticarPagina, execD1Local, queryD1Local } from './session';

/**
 * O formulário único da operação e o slider de `/gise/operacoes`.
 *
 * O que este spec protege é a UNIFICAÇÃO: até ago/2026 criar uma operação
 * preenchia só a identidade, e as vagas, horários e textos do PDF ficavam atrás
 * de um segundo botão, numa rota à parte. Quem criava saía da tela com metade da
 * operação por configurar, sem nada indicando isso.
 *
 * O caso central é o de ida e volta pelo BANCO: criar com os campos de
 * configuração preenchidos e conferir que as nove colunas chegaram lá. Sem isso,
 * um `name=` errado no formulário passaria despercebido — a tela salva, o toast
 * aparece, e o valor some.
 *
 * A distinção `NULL` × `0` também vive aqui, e é a que mais se perde numa
 * refatoração: vazio significa "herda o padrão do sistema" e zero significa
 * "esta equipe não tem essa vaga".
 */

const NOME = 'OPERACAO E2E FORMULARIO';

/** Lê a operação do cenário direto do banco — é o efeito, não a tela, que importa. */
function operacaoGravada(): Record<string, unknown> | null {
	const linhas = queryD1Local<Record<string, unknown>>(
		`SELECT id, nome, sigla, usa_equipe_operacional, usa_equipe_seint,
		        vagas_operacional_dpc, vagas_operacional_oip, vagas_seint_dpc, vagas_seint_oip,
		        hora_entrada_padrao, hora_saida_padrao, breve_relatorio_titulo
		 FROM operacoes WHERE nome = '${NOME}'`
	);
	return linhas?.[0] ?? null;
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(() => {
	execD1Local(`DELETE FROM operacoes WHERE nome = '${NOME}';`);
});

test.afterAll(() => {
	execD1Local(`DELETE FROM operacoes WHERE nome = '${NOME}';`);
});

test('criar pede identificação E configuração no mesmo formulário, e grava as duas', async ({
	page
}) => {
	const ok = await autenticarPagina(page, FIXTURE.adminGeral.id, 'admin');
	test.skip(!ok, 'D1 local indisponível');

	await page.goto('/gise/operacoes');
	await page.getByRole('button', { name: 'Nova operação' }).click();

	// O painel aberto vive na URL — é o que faz o "voltar" do navegador desfazer.
	await expect(page).toHaveURL(/\?form=nova/);
	await expect(page.getByRole('heading', { name: 'Nova operação' })).toBeVisible();

	// Os campos que antes só existiam atrás do botão "Configurações" estão aqui.
	await expect(page.locator('#op_dpc')).toBeVisible();
	await expect(page.locator('#hora_entrada')).toBeVisible();
	await expect(page.locator('#breve_tit')).toBeVisible();

	await page.locator('#f_nome').fill(NOME);
	await page.locator('#f_sigla').fill('E2E-FORM');
	await page.locator('#op_dpc').fill('2');
	// ZERO, e não vazio: "esta equipe não tem vaga de DPC" é uma escolha.
	await page.locator('#seint_dpc').fill('0');
	await page.locator('#hora_entrada').fill('07:30');
	await page.locator('#breve_tit').fill('Relatório da operação E2E');
	// `op_oip` e `seint_oip` ficam VAZIOS de propósito: têm de gravar NULL.

	await page.getByRole('button', { name: 'Criar operação' }).click();
	await expect(page).not.toHaveURL(/\?form=/);

	const op = operacaoGravada();
	expect(op).not.toBeNull();
	expect(op!.sigla).toBe('E2E-FORM');
	expect(Number(op!.vagas_operacional_dpc)).toBe(2);
	expect(op!.hora_entrada_padrao).toBe('07:30');
	expect(op!.breve_relatorio_titulo).toBe('Relatório da operação E2E');

	// Zero é zero; vazio é NULL (herda). Confundir os dois faria "0 DPC" virar o
	// padrão do sistema no próximo salvamento.
	expect(Number(op!.vagas_seint_dpc)).toBe(0);
	expect(op!.vagas_operacional_oip).toBeNull();
	expect(op!.vagas_seint_oip).toBeNull();
	expect(op!.hora_saida_padrao).toBeNull();
});

test('editar abre o MESMO formulário, já preenchido com identidade e configuração', async ({
	page
}) => {
	const ok = await autenticarPagina(page, FIXTURE.adminGeral.id, 'admin');
	test.skip(!ok, 'D1 local indisponível');
	const op = operacaoGravada();
	test.skip(op == null, 'operação do cenário não foi criada');

	await page.goto('/gise/operacoes');
	// Só a linha desta operação — a lista tem GISE e CRAJUBAR junto.
	const linha = page.locator('li').filter({ hasText: NOME });
	await linha.getByRole('button', { name: 'Editar' }).click();

	await expect(page).toHaveURL(new RegExp(`\\?form=${op!.id}`));
	await expect(page.getByRole('heading', { name: NOME })).toBeVisible();

	// Identidade e configuração, no mesmo lugar e com os valores de volta.
	await expect(page.locator('#f_sigla')).toHaveValue('E2E-FORM');
	await expect(page.locator('#op_dpc')).toHaveValue('2');
	await expect(page.locator('#seint_dpc')).toHaveValue('0');
	await expect(page.locator('#breve_tit')).toHaveValue('Relatório da operação E2E');
	// Campo herdado volta VAZIO, com o padrão do sistema no placeholder.
	await expect(page.locator('#op_oip')).toHaveValue('');
	await expect(page.locator('#op_oip')).toHaveAttribute('placeholder', /\d+/);

	// "Basear o formulário em" só existe ao criar: reclonar na edição
	// sobrescreveria um formulário já em uso.
	await expect(page.locator('#f_base')).toHaveCount(0);
});

test('o endereço antigo de configurações redireciona para o painel de edição', async ({ page }) => {
	const ok = await autenticarPagina(page, FIXTURE.adminGeral.id, 'admin');
	test.skip(!ok, 'D1 local indisponível');
	const op = operacaoGravada();
	test.skip(op == null, 'operação do cenário não foi criada');

	await page.goto(`/gise/operacoes/${op!.id}/config`);
	await expect(page).toHaveURL(new RegExp(`/gise/operacoes\\?form=${op!.id}`));
	await expect(page.locator('#op_dpc')).toHaveValue('2');
});

test('a linha traz Formulário e Editar, e NÃO traz mais "Configurações"', async ({ page }) => {
	const ok = await autenticarPagina(page, FIXTURE.adminGeral.id, 'admin');
	test.skip(!ok, 'D1 local indisponível');

	await page.goto('/gise/operacoes');

	const linha = page.locator('li').filter({ hasText: NOME });
	await expect(linha.getByRole('link', { name: 'Formulário' })).toBeVisible();
	await expect(linha.getByRole('button', { name: 'Editar' })).toBeVisible();
	// Virou parte de "Editar".
	await expect(linha.getByRole('link', { name: 'Configurações' })).toHaveCount(0);
	// E "Dados base" não aparece: esta operação não tem indicador percentual.
	// (a linha da que TEM está em `operacoes-linha-base.spec.ts`)
	await expect(linha.getByRole('link', { name: 'Dados base' })).toHaveCount(0);
});

test('o editor de formulário tem o voltar para as operações', async ({ page }) => {
	const ok = await autenticarPagina(page, FIXTURE.adminGeral.id, 'admin');
	test.skip(!ok, 'D1 local indisponível');

	await page.goto('/res-gise');
	// Acima do título, como nas demais telas de detalhe.
	const voltar = page.getByRole('link', { name: 'Voltar às operações' });
	await expect(voltar).toBeVisible();
	await voltar.click();
	await expect(page).toHaveURL(/\/gise\/operacoes/);
});
