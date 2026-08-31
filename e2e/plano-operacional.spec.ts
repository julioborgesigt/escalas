import { test, expect, request as pwRequest } from '@playwright/test';
import { FIXTURE } from './global-setup';
import {
	seedSession,
	cookieDeSessao,
	headersFormAction,
	execD1Local,
	queryD1Local,
	BASE_URL
} from './session';

/**
 * Plano operacional de ponta a ponta: valores → plano → equipes → PDF.
 *
 * O que só ESTA suíte alcança (os unitários cobrem as regras isoladas):
 *
 *  - a **cadeia de papéis**: os valores são do Super Admin, o plano é do Admin
 *    Geral, e o plano nasce amarrado à versão de valores vigente NAQUELE
 *    momento;
 *  - a **recusa de emissão por cadastro incompleto**, no servidor. A tela
 *    desabilita o botão, mas o teste que importa é o GET direto: sem ele, colar
 *    a URL na barra emitiria um documento orçado a menor;
 *  - o **congelamento**: gravar uma tabela de valores NOVA depois do plano não
 *    pode mudar o PDF dele. É a razão de a tabela ser versionada, e nenhum
 *    unitário prova isso ponta a ponta.
 *
 * Como as contas fixture entram: sessão semeada no D1 local (ver `session.ts`)
 * — o login por senha é fail-closed no 2FA e o runner não tem caixa de entrada.
 *
 * O Super Admin depende de `SUPER_ADMIN_LOGIN` bater com o login do fixture; o
 * `servidor-e2e.ts` garante isso, mas um dev com o seu próprio valor faz a
 * sessão não virar super admin — daí o probe e o skip, como em `auditoria.spec`.
 */

/** Matrículas dos servidores criados aqui — o `afterAll` apaga por elas. */
const MAT_COM_CLASSE = 'PLANE2E01';
const MAT_SEM_CLASSE = 'PLANE2E02';
const NOME_PLANO = 'OPERACAO E2E PLANO OPERACIONAL';

let tokenSuper: string | null = null;
let tokenAdmin: string | null = null;
let ehSuperAdmin = false;
let planoId: number | null = null;
/** As versões de valores que ESTE spec gravou — apagadas no fim. */
const versoesCriadas: number[] = [];

/** Um `<form>` do SvelteKit: `FormData` serializado como urlencoded. */
function form(campos: Record<string, string>): string {
	return new URLSearchParams(campos).toString();
}

/** O `id` do único registro que a consulta devolve, ou `null`. */
function idDe(sql: string): number | null {
	const linhas = queryD1Local<{ id: number }>(sql);
	return linhas && linhas.length > 0 ? Number(linhas[0].id) : null;
}

/**
 * A versão VIGENTE pela regra do app — `ORDER BY vigente_desde DESC, id DESC`.
 *
 * Não é `MAX(id)`, e a diferença já reprovou este spec: vigência é por DATA, e
 * uma versão gravada depois com data anterior continua não sendo a vigente.
 */
function versaoVigente(): number | null {
	return idDe(`SELECT id FROM custo_parametros ORDER BY vigente_desde DESC, id DESC LIMIT 1;`);
}

/**
 * Uma data de vigência que ganha de tudo o que já está no banco.
 *
 * O D1 local é COMPARTILHADO com o desenvolvimento — pode ter versões de
 * qualquer data. Fixar `'2026-01-01'` aqui fazia o spec depender de o banco
 * estar limpo, que é a forma mais silenciosa de teste frágil: ele passa na
 * máquina de quem escreveu e reprova na do próximo.
 */
function proximaVigencia(): string {
	const linhas = queryD1Local<{ d: string | null }>(
		`SELECT MAX(vigente_desde) AS d FROM custo_parametros;`
	);
	const atual = linhas?.[0]?.d;
	const base = atual ? new Date(atual + 'T12:00:00Z') : new Date();
	base.setUTCDate(base.getUTCDate() + 1);
	return base.toISOString().slice(0, 10);
}

test.beforeAll(async () => {
	tokenSuper = seedSession(FIXTURE.superAdmin.id, 'admin');
	tokenAdmin = seedSession(FIXTURE.adminGeral.id, 'admin');
	if (!tokenSuper || !tokenAdmin) return;

	const ctx = await pwRequest.newContext({ baseURL: BASE_URL });
	const probe = await ctx.get('/api/admin/audit?limit=1', { headers: cookieDeSessao(tokenSuper) });
	ehSuperAdmin = probe.status() === 200;
	await ctx.dispose();

	// Dois servidores no MESMO cargo e classes diferentes: um resolve faixa de
	// custo, o outro não. É a diferença que o gate de emissão enxerga.
	execD1Local(
		`INSERT OR REPLACE INTO policiais (matricula, nome, cargo, classe, lotacao, telefone, senha, primeiro_acesso, ativo)
		 VALUES
		   ('${MAT_COM_CLASSE}', 'SERVIDOR E2E COM CLASSE', 'OIP', 'C', '${FIXTURE.unidadeA.nome}', '85 90000-0001', 'x', 0, 1),
		   ('${MAT_SEM_CLASSE}', 'SERVIDOR E2E SEM CLASSE', 'OIP', '',  '${FIXTURE.unidadeA.nome}', '85 90000-0002', 'x', 0, 1);`
	);
});

test.afterAll(() => {
	// O plano leva equipes e membros junto (CASCADE); os servidores saem por
	// matrícula. Sem isto, a próxima execução acha efetivo de sobra.
	// Ordem obrigatória: `custo_parametro_id` é RESTRICT, então o plano sai antes
	// das versões que ele referencia.
	if (planoId) execD1Local(`DELETE FROM planos_operacionais WHERE id = ${planoId};`);
	if (versoesCriadas.length > 0) {
		execD1Local(`DELETE FROM custo_parametros WHERE id IN (${versoesCriadas.join(',')});`);
	}
	execD1Local(
		`DELETE FROM policiais WHERE matricula IN ('${MAT_COM_CLASSE}', '${MAT_SEM_CLASSE}');`
	);
});

test.describe.serial('Plano operacional — valores, plano e PDF', () => {
	test.skip(() => !tokenSuper || !tokenAdmin, 'D1 local indisponível');

	test('Super Admin grava a tabela de valores; Admin Geral não alcança a tela', async ({
		request
	}) => {
		test.skip(!ehSuperAdmin, 'Super Admin fixture indisponível (SUPER_ADMIN_LOGIN)');

		const res = await request.post('/config-custos?/salvarValores', {
			headers: {
				...headersFormAction(tokenSuper!),
				'content-type': 'application/x-www-form-urlencoded'
			},
			data: form({
				oip_cd_normal: '27,30',
				oip_ab_normal: '34,13',
				dpc_12_normal: '50,00',
				dpc_3e_normal: '60,00',
				oip_cd_plus: '35,49',
				oip_ab_plus: '44,37',
				dpc_12_plus: '65,00',
				dpc_3e_plus: '78,00',
				diaria_estadual: '350,00',
				diaria_interestadual: '600,00',
				vigente_desde: proximaVigencia()
			})
		});
		expect(res.status()).toBe(200);

		const versao = versaoVigente();
		expect(versao, 'a gravação tem de criar uma versão').not.toBeNull();
		versoesCriadas.push(versao!);

		// A tela é do Super Admin. O Admin Geral é redirecionado — o `load`
		// recusa, não o menu.
		const negado = await request.get('/config-custos', {
			headers: cookieDeSessao(tokenAdmin!),
			maxRedirects: 0
		});
		expect(negado.status()).toBeGreaterThanOrEqual(300);
		expect(negado.status()).toBeLessThan(400);
	});

	test('Admin Geral cria o plano, que nasce amarrado à versão vigente', async ({ request }) => {
		const res = await request.post('/gise/planos/novo?/criar', {
			headers: {
				...headersFormAction(tokenAdmin!),
				'content-type': 'application/x-www-form-urlencoded'
			},
			data: form({
				nome: NOME_PLANO,
				nup: '2026.E2E.00001',
				departamento: 'DPI SUL',
				// Sábado: toda hora da janela é hora extra PLUS. Escolhido de
				// propósito — em dia útil das 08:00 às 18:00 o custo seria zero, e
				// zero legítimo não distingue "sem custo" de "cálculo quebrado".
				data_inicio: '2026-08-01',
				hora_inicio: '05:00',
				hora_fim: '11:00',
				local_briefing_padrao: 'Sede E2E',
				qtd_equipes: '2',
				oip_por_equipe: '4'
			})
		});
		expect(res.status()).toBe(200);

		planoId = idDe(
			`SELECT id FROM planos_operacionais WHERE nome = '${NOME_PLANO}' ORDER BY id DESC LIMIT 1;`
		);
		expect(planoId, 'o plano tem de existir depois da action').not.toBeNull();

		const doPlano = idDe(
			`SELECT custo_parametro_id AS id FROM planos_operacionais WHERE id = ${planoId};`
		);
		expect(doPlano).toBe(versaoVigente());

		const equipes = queryD1Local<{ id: number }>(
			`SELECT id FROM plano_equipes WHERE plano_id = ${planoId} ORDER BY ordem;`
		);
		expect(equipes?.length).toBe(2);
	});

	test('servidor sem classe resolvida faz o download recusar com 409', async ({ request }) => {
		const equipe = idDe(
			`SELECT id FROM plano_equipes WHERE plano_id = ${planoId} ORDER BY ordem LIMIT 1;`
		);
		const semClasse = idDe(`SELECT id FROM policiais WHERE matricula = '${MAT_SEM_CLASSE}';`);

		// A equipe cobra hora extra; sem faixa resolvida a linha dele valeria R$ 0.
		execD1Local(
			`UPDATE plano_equipes SET tipo_custo = 'hora_extra', horas_plus = 6 WHERE id = ${equipe};`
		);
		const add = await request.post(`/gise/planos/${planoId}?/adicionarMembro`, {
			headers: {
				...headersFormAction(tokenAdmin!),
				'content-type': 'application/x-www-form-urlencoded'
			},
			data: form({ equipe_id: String(equipe), policial_id: String(semClasse) })
		});
		expect(add.status()).toBe(200);

		const res = await request.get(`/api/planos/${planoId}/download`, {
			headers: cookieDeSessao(tokenAdmin!)
		});
		expect(res.status()).toBe(409);
		const corpo = await res.json();
		// A mensagem NOMEIA quem falta: "corrija o cadastro" sem dizer de quem
		// manda o admin procurar linha a linha.
		expect(String(corpo.error)).toContain('SERVIDOR E2E SEM CLASSE');
	});

	test('resolvido o cadastro, o PDF sai com nome de arquivo e tipo corretos', async ({
		request
	}) => {
		const semClasse = idDe(`SELECT id FROM policiais WHERE matricula = '${MAT_SEM_CLASSE}';`);
		const comClasse = idDe(`SELECT id FROM policiais WHERE matricula = '${MAT_COM_CLASSE}';`);
		const equipe = idDe(
			`SELECT id FROM plano_equipes WHERE plano_id = ${planoId} ORDER BY ordem LIMIT 1;`
		);

		// Troca o pendente por quem tem classe — é o que o admin faria na tela.
		const membro = idDe(
			`SELECT id FROM plano_equipe_membros WHERE plano_id = ${planoId} AND policial_id = ${semClasse};`
		);
		const rem = await request.post(`/gise/planos/${planoId}?/removerMembro`, {
			headers: {
				...headersFormAction(tokenAdmin!),
				'content-type': 'application/x-www-form-urlencoded'
			},
			data: form({ membro_id: String(membro) })
		});
		expect(rem.status()).toBe(200);

		const add = await request.post(`/gise/planos/${planoId}?/adicionarMembro`, {
			headers: {
				...headersFormAction(tokenAdmin!),
				'content-type': 'application/x-www-form-urlencoded'
			},
			data: form({ equipe_id: String(equipe), policial_id: String(comClasse) })
		});
		expect(add.status()).toBe(200);

		const res = await request.get(`/api/planos/${planoId}/download`, {
			headers: cookieDeSessao(tokenAdmin!)
		});
		expect(res.status()).toBe(200);
		expect(res.headers()['content-type']).toContain('application/pdf');

		const numero = queryD1Local<{ numero: number; ano: number }>(
			`SELECT numero, ano FROM planos_operacionais WHERE id = ${planoId};`
		);
		const esperado = `plano_operacional_${numero![0].numero}_${numero![0].ano}.pdf`;
		expect(res.headers()['content-disposition']).toContain(esperado);

		const bytes = await res.body();
		expect(bytes.length).toBeGreaterThan(5000);
		expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
	});

	test('o download fica registrado na auditoria antes de qualquer byte', async () => {
		const linhas = queryD1Local<{ n: number }>(
			`SELECT COUNT(*) AS n FROM audit_log
			 WHERE acao = 'exportar_plano_operacional' AND entidade_id = ${planoId};`
		);
		// Duas tentativas de download acima: a recusada por 409 TAMBÉM audita —
		// baixar é acesso a dado pessoal, e o registro vem antes da emissão.
		expect(Number(linhas![0].n)).toBeGreaterThanOrEqual(2);
	});

	test('reajustar os valores NÃO muda o PDF do plano já criado', async ({ request }) => {
		test.skip(!ehSuperAdmin, 'Super Admin fixture indisponível (SUPER_ADMIN_LOGIN)');

		const antes = await request.get(`/api/planos/${planoId}/download`, {
			headers: cookieDeSessao(tokenAdmin!)
		});
		const bytesAntes = await antes.body();

		// Uma versão NOVA, com o dobro do valor da hora do OIP C.
		const reajuste = await request.post('/config-custos?/salvarValores', {
			headers: {
				...headersFormAction(tokenSuper!),
				'content-type': 'application/x-www-form-urlencoded'
			},
			data: form({
				oip_cd_normal: '54,60',
				oip_ab_normal: '68,26',
				dpc_12_normal: '100,00',
				dpc_3e_normal: '120,00',
				oip_cd_plus: '70,98',
				oip_ab_plus: '88,74',
				dpc_12_plus: '130,00',
				dpc_3e_plus: '156,00',
				diaria_estadual: '700,00',
				diaria_interestadual: '1200,00',
				vigente_desde: proximaVigencia()
			})
		});
		expect(reajuste.status()).toBe(200);
		versoesCriadas.push(versaoVigente()!);
		// O reajuste É a nova vigente — se não fosse, o teste abaixo passaria por
		// não ter acontecido nada.
		expect(versaoVigente()).not.toBe(
			idDe(`SELECT custo_parametro_id AS id FROM planos_operacionais WHERE id = ${planoId};`)
		);

		const depois = await request.get(`/api/planos/${planoId}/download`, {
			headers: cookieDeSessao(tokenAdmin!)
		});
		const bytesDepois = await depois.body();

		// Byte a byte não serve: o jsPDF grava um /ID aleatório no trailer. O que
		// tem de bater é o TAMANHO e o total impresso — se o plano tivesse migrado
		// para a versão nova, o valor no Anexo II dobraria e o arquivo mudaria de
		// tamanho junto com o texto.
		expect(bytesDepois.length).toBe(bytesAntes.length);
		// A equipe cobra 6h PLUS de um OIP C: 6 × 35,49 = 212,94 com a tabela do
		// plano, e 6 × 70,98 = 425,88 com a do reajuste. É o par que distingue
		// "congelou" de "migrou" — o tamanho igual acima sozinho não distinguiria
		// dois valores de mesma largura.
		expect(bytesDepois.toString('latin1')).toContain('R$ 212,94');
		expect(bytesDepois.toString('latin1')).not.toContain('R$ 425,88');
	});
});
