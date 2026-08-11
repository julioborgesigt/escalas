import { test, expect } from '@playwright/test';
import { FIXTURE } from './global-setup';
import { autenticarPagina, execD1Local, queryD1Local } from './session';

/**
 * O que o painel de produtividade MOSTRA — e o que ele para de mostrar.
 *
 * Dois bugs relatados em ago/2026, e os dois são da mesma família: a tela
 * afirmava coisas sobre perguntas que o formulário não tinha.
 *
 * 1. **Os três blocos fixos apareciam sempre.** Prisões, drogas e armas são
 *    cards escritos no código, e renderizavam em qualquer operação operacional.
 *    Numa operação nova, cujo formulário nunca teve pergunta de droga, a tela
 *    exibia "Ranking de Drogas" zerado. Apagar o campo do formulário não
 *    resolvia, porque o card nunca dependeu do campo.
 * 2. **Toda pergunta contável virava gráfico.** A quilometragem inicial da
 *    viatura ocupava um card ao lado das prisões, e o único jeito de tirá-la era
 *    apagar o campo — o que apagaria a coleta.
 *
 * O cenário é montado com DOIS modelos de propósito: um formulário "enxuto"
 * (sem droga, sem arma, com uma pergunta marcada e outra não) e um "completo".
 * É a comparação entre os dois que prova a regra, e nenhum teste unitário
 * consegue provar que a TELA obedece a ela.
 */

/** Ids exclusivos deste spec — não colidem com a fixture nem com os outros cenários. */
const C = {
	enxuta: 'OPERACAO E2E GRAFICOS ENXUTA',
	completa: 'OPERACAO E2E GRAFICOS COMPLETA',
	seccional: { id: 99510, nome: 'SECCIONAL E2E GRAFICOS' },
	giseEnxuta: 99501,
	giseCompleta: 99502,
	secEnxuta: 99501,
	secCompleta: 99502,
	equipeEnxuta: 99501,
	equipeCompleta: 99502
};

/**
 * O formulário enxuto: uma pergunta MARCADA como gráfico e uma não marcada.
 *
 * A não marcada é a quilometragem — o caso exato do relato. As duas são do mesmo
 * tipo (`numero`), então só a marca as separa; fosse o tipo, o teste não provaria
 * nada.
 */
const MODELO_ENXUTO = JSON.stringify([
	{
		id: 1,
		texto: 'ATENDIMENTOS REALIZADOS',
		tipo: 'numero',
		key: 'e2e_atendimentos',
		grafico: true,
		filhos: []
	},
	{ id: 2, texto: 'KM INICIAL DA VIATURA', tipo: 'numero', key: 'e2e_km_inicial', filhos: [] }
]);

/** O formulário completo: tem as perguntas que alimentam os três blocos fixos. */
const MODELO_COMPLETO = JSON.stringify([
	{
		id: 4,
		texto: 'HOUVE FLAGRANTE?',
		tipo: 'prisoes_maiores',
		key: 'procedimentos_flagrante_bool',
		filhos: []
	},
	{
		id: 10,
		texto: 'APREENSAO DE DROGAS',
		tipo: 'drogas_complex',
		key: 'apreensoes_drogas',
		filhos: []
	},
	{
		id: 11,
		texto: 'HOUVE APREENSAO DE ARMAS?',
		tipo: 'armas_complex',
		key: 'apreensoes_armas_bool',
		filhos: []
	}
]);

let cenarioOk = false;

test.beforeAll(() => {
	cenarioOk = execD1Local(`
		INSERT INTO operacoes (nome, sigla) VALUES
			('${C.enxuta}', 'E2E-GE'), ('${C.completa}', 'E2E-GC')
		ON CONFLICT(nome) DO NOTHING;
		INSERT INTO unidades (id, nome, tipo) VALUES
			(${C.seccional.id}, '${C.seccional.nome}', 'seccional')
		ON CONFLICT(id) DO UPDATE SET nome = excluded.nome;

		INSERT INTO gise_escalas (id, data_inicio, status, hora_entrada, hora_saida, operacao_id) VALUES
			(${C.giseEnxuta}, '2026-05-11', 'finalizada', '08:00', '16:00',
				(SELECT id FROM operacoes WHERE nome = '${C.enxuta}')),
			(${C.giseCompleta}, '2026-05-12', 'finalizada', '08:00', '16:00',
				(SELECT id FROM operacoes WHERE nome = '${C.completa}'))
		ON CONFLICT(id) DO UPDATE SET operacao_id = excluded.operacao_id;

		INSERT INTO gise_seccionais (id, gise_id, seccional_id, status) VALUES
			(${C.secEnxuta}, ${C.giseEnxuta}, ${C.seccional.id}, 'preenchida'),
			(${C.secCompleta}, ${C.giseCompleta}, ${C.seccional.id}, 'preenchida')
		ON CONFLICT(id) DO UPDATE SET gise_id = excluded.gise_id;

		DELETE FROM gise_equipes WHERE gise_seccional_id IN (${C.secEnxuta}, ${C.secCompleta});
		INSERT INTO gise_equipes (id, gise_seccional_id, gise_unidade_id, tipo, slots_dpc, slots_oip) VALUES
			(${C.equipeEnxuta}, ${C.secEnxuta}, NULL, 'operacional', 1, 3),
			(${C.equipeCompleta}, ${C.secCompleta}, NULL, 'operacional', 1, 3);

		DELETE FROM gise_modelo_formulario WHERE operacao_id IN (
			SELECT id FROM operacoes WHERE nome IN ('${C.enxuta}', '${C.completa}'));
		INSERT INTO gise_modelo_formulario (operacao_id, tipo, config) VALUES
			((SELECT id FROM operacoes WHERE nome = '${C.enxuta}'), 'operacional', '${MODELO_ENXUTO}'),
			((SELECT id FROM operacoes WHERE nome = '${C.completa}'), 'operacional', '${MODELO_COMPLETO}');

		DELETE FROM gise_respostas_formulario WHERE gise_id IN (${C.giseEnxuta}, ${C.giseCompleta});
		INSERT INTO gise_respostas_formulario (gise_id, policial_id, equipe_id, respostas) VALUES
			(${C.giseEnxuta}, ${FIXTURE.membroGise.id}, ${C.equipeEnxuta},
				'{"e2e_atendimentos":7,"e2e_km_inicial":12345}');
	`);
});

test.afterAll(() => {
	execD1Local(`
		DELETE FROM gise_escalas WHERE id IN (${C.giseEnxuta}, ${C.giseCompleta});
		DELETE FROM gise_modelo_formulario WHERE operacao_id IN (
			SELECT id FROM operacoes WHERE nome IN ('${C.enxuta}', '${C.completa}'));
		DELETE FROM operacoes WHERE nome IN ('${C.enxuta}', '${C.completa}');
	`);
});

function operacaoId(nome: string): number | null {
	const linhas = queryD1Local<{ id: number }>(`SELECT id FROM operacoes WHERE nome = '${nome}'`);
	return linhas?.[0]?.id ?? null;
}

/** Abre o painel na operação, com o ano do cenário já escolhido. */
async function abrirPainel(page: import('@playwright/test').Page, nome: string) {
	const id = operacaoId(nome);
	if (id == null) return false;
	await page.goto(`/produtividade?operacaoId=${id}`);
	await page.locator('#f-ano').selectOption('2026');
	return true;
}

test.describe.configure({ mode: 'serial' });

test('só a pergunta MARCADA vira gráfico', async ({ page }) => {
	test.skip(!cenarioOk, 'D1 local indisponível');
	const ok = await autenticarPagina(page, FIXTURE.adminGeral.id, 'admin');
	test.skip(!ok, 'D1 local indisponível');
	test.skip(!(await abrirPainel(page, C.enxuta)), 'operação do cenário não foi criada');

	// A marcada aparece, com o total do período.
	await expect(page.getByText('ATENDIMENTOS REALIZADOS')).toBeVisible();
	await expect(page.getByText('7', { exact: true }).first()).toBeVisible();

	// A quilometragem NÃO — é o pedido inteiro deste ciclo. O dado está gravado
	// (12345 no blob) e continua sendo coletado; só não vira card.
	await expect(page.getByText('KM INICIAL DA VIATURA')).toHaveCount(0);
	await expect(page.getByText('12345')).toHaveCount(0);
});

test('os blocos fixos SOMEM na operação cujo formulário não tem a pergunta', async ({ page }) => {
	test.skip(!cenarioOk, 'D1 local indisponível');
	const ok = await autenticarPagina(page, FIXTURE.adminGeral.id, 'admin');
	test.skip(!ok, 'D1 local indisponível');
	test.skip(!(await abrirPainel(page, C.enxuta)), 'operação do cenário não foi criada');

	// O bug relatado: os seis cards apareciam zerados numa operação que nunca
	// perguntou sobre droga, arma ou flagrante.
	await expect(page.getByText('Ranking de Prisões')).toHaveCount(0);
	await expect(page.getByText('Ranking de Drogas')).toHaveCount(0);
	await expect(page.getByText('Ranking de Armas')).toHaveCount(0);
	await expect(page.getByText('Detalhamento de Substâncias')).toHaveCount(0);
});

test('e APARECEM na operação cujo formulário tem', async ({ page }) => {
	test.skip(!cenarioOk, 'D1 local indisponível');
	const ok = await autenticarPagina(page, FIXTURE.adminGeral.id, 'admin');
	test.skip(!ok, 'D1 local indisponível');
	test.skip(!(await abrirPainel(page, C.completa)), 'operação do cenário não foi criada');

	// A contraprova: o bloco não sumiu por acidente de renderização.
	await expect(page.getByText('Ranking de Prisões')).toBeVisible();
	await expect(page.getByText('Ranking de Drogas')).toBeVisible();
	await expect(page.getByText('Ranking de Armas')).toBeVisible();
});

test('operação sem nada a mostrar explica o que fazer, em vez de ficar em branco', async ({
	page
}) => {
	test.skip(!cenarioOk, 'D1 local indisponível');
	const ok = await autenticarPagina(page, FIXTURE.adminGeral.id, 'admin');
	test.skip(!ok, 'D1 local indisponível');
	const id = operacaoId(C.enxuta);
	test.skip(id == null, 'operação do cenário não foi criada');

	// Desmarca a última pergunta que restava: o painel fica sem indicador, sem
	// bloco fixo e sem gráfico.
	execD1Local(
		`UPDATE gise_modelo_formulario
		 SET config = json_remove(config, '$[0].grafico')
		 WHERE operacao_id = ${id} AND tipo = 'operacional';`
	);

	await page.goto(`/produtividade?operacaoId=${id}`);
	await expect(page.getByText('Nada a mostrar nesta operação')).toBeVisible();
	// O conserto não está nesta página, e a tela diz onde está.
	await expect(page.getByText('Mostrar como gráfico na produtividade')).toBeVisible();

	// Repõe a marca para não deixar o cenário sujo se o spec for reexecutado.
	execD1Local(
		`UPDATE gise_modelo_formulario
		 SET config = json_set(config, '$[0].grafico', json('true'))
		 WHERE operacao_id = ${id} AND tipo = 'operacional';`
	);
});

test('o editor traz a caixinha, e ela reflete o que está gravado', async ({ page }) => {
	test.skip(!cenarioOk, 'D1 local indisponível');
	const ok = await autenticarPagina(page, FIXTURE.adminGeral.id, 'admin');
	test.skip(!ok, 'D1 local indisponível');
	const id = operacaoId(C.enxuta);
	test.skip(id == null, 'operação do cenário não foi criada');

	await page.goto(`/res-gise?operacaoId=${id}`);

	// Uma caixinha por pergunta graficável — as duas são `numero`.
	const caixas = page.getByRole('checkbox', { name: /Mostrar como gráfico/ });
	await expect(caixas).toHaveCount(2);
	// A primeira é a marcada; a segunda, a quilometragem.
	await expect(caixas.nth(0)).toBeChecked();
	await expect(caixas.nth(1)).not.toBeChecked();
});

test('desmarcar no editor e salvar tira o card do painel', async ({ page }) => {
	test.skip(!cenarioOk, 'D1 local indisponível');
	const ok = await autenticarPagina(page, FIXTURE.adminGeral.id, 'admin');
	test.skip(!ok, 'D1 local indisponível');
	const id = operacaoId(C.enxuta);
	test.skip(id == null, 'operação do cenário não foi criada');

	// A ida e volta pelo BANCO é o que este caso protege: a action grava o
	// `config` cru, e um campo perdido na serialização faria a caixinha "salvar"
	// sem efeito nenhum — a tela confirma, o gráfico volta no reload.
	await page.goto(`/res-gise?operacaoId=${id}`);
	await page
		.getByRole('checkbox', { name: /Mostrar como gráfico/ })
		.nth(0)
		.uncheck();
	await page.getByRole('button', { name: /Salvar Modelo/ }).click();
	await expect(page.getByText(/Nada é gravado ainda/)).toHaveCount(0);

	const gravado = queryD1Local<{ config: string }>(
		`SELECT config FROM gise_modelo_formulario WHERE operacao_id = ${id} AND tipo = 'operacional'`
	);
	const perguntas = JSON.parse(gravado?.[0]?.config ?? '[]') as Array<{
		key: string;
		grafico?: boolean;
	}>;
	// Ausente, e não `false`: a ausência já é a resposta.
	expect(perguntas.find((q) => q.key === 'e2e_atendimentos')?.grafico).toBeUndefined();

	await page.goto(`/produtividade?operacaoId=${id}`);
	await expect(page.getByText('ATENDIMENTOS REALIZADOS')).toHaveCount(0);

	// Repõe, para o spec poder rodar de novo sobre o mesmo banco local.
	execD1Local(
		`UPDATE gise_modelo_formulario
		 SET config = json_set(config, '$[0].grafico', json('true'))
		 WHERE operacao_id = ${id} AND tipo = 'operacional';`
	);
});
