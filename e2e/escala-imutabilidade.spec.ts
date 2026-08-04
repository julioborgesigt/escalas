import { test, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { FIXTURE } from './global-setup';
import { seedSession, headersFormAction, execD1Local, queryD1Local } from './session';

/**
 * Os dois P0 de escala que a auditoria de fluxos confirmou e que a UI
 * escondia sem o servidor recusar — FLW-ESC-002 e FLW-ESC-003.
 *
 * **FLW-ESC-002 — item de outra escala por ID.** As actions de conteúdo
 * usavam `escala_policiais.id` sem combinar com a escala da URL. Quem tinha
 * permissão na escala A editava ou apagava linha da escala B só mandando o
 * `item_id` dela. Das quatro mutações sobre a tabela, UMA amarrava o
 * `escala_id` e três não — a mesma divergência por cópia que a auditoria de
 * comentários vinha perseguindo, agora na camada onde divergir é
 * vulnerabilidade.
 *
 * **FLW-ESC-003 — documento assinado não era imutável.** Havia PDF com hash e
 * carimbo de tempo atestando uma composição que as dez actions de conteúdo
 * trocavam por baixo: o documento seguia válido criptograficamente e passava a
 * descrever uma escala que não existe mais. Só uma das catorze actions checava
 * `finalizada_em`; nenhuma checava assinatura.
 *
 * Estes testes são pelo HTTP de propósito. O que está sob teste é a recusa na
 * BORDA — o POST direto que não passa pela tela —, e é justamente o que teste
 * de unidade da camada de dados não alcança.
 */

const LOT_A = FIXTURE.unidadeA.nome;
const TITULO = 'E2E-IMUT';
/** Escala normal da unidade A: alvo das mutações legítimas. */
const ESCALA_X = 99070;
/** Outra escala da MESMA unidade — o ator tem permissão nas duas. */
const ESCALA_Y = 99071;
/** Escala da unidade A com documento assinado. */
const ESCALA_ASSINADA = 99072;
/** Escala de FDS já finalizada. */
const ESCALA_FINALIZADA = 99073;

let token: string | null = null;
/** `escala_policiais.id` da linha que vive na escala Y. */
let itemDeY = 0;

function seedEscala(id: number, sufixo: string, tipo = 'expediente'): boolean {
	return execD1Local(
		`INSERT OR REPLACE INTO escalas (id, titulo, cidade, tipo, lotacao, data_inicio, data_fim, hora_entrada, hora_saida) ` +
			`VALUES (${id}, '${TITULO} ${sufixo}', 'Fortaleza', '${tipo}', '${LOT_A}', '2026-11-01', '2026-11-30', '08', '08');`
	);
}

function seedItem(escalaId: number, data: string): boolean {
	return execD1Local(
		`INSERT INTO escala_policiais (escala_id, policial_id, data_plantao, hora_entrada, hora_saida, equipe) ` +
			`VALUES (${escalaId}, ${FIXTURE.policialA.id}, '${data}', '08:00', '18:00', '1');`
	);
}

/** Lê o id da (única) linha de uma escala — `-1` quando não há. */
function idDoItem(escalaId: number): number {
	const linhas = queryD1Local<{ id: number }>(
		`SELECT id FROM escala_policiais WHERE escala_id = ${escalaId} ORDER BY id LIMIT 1;`
	);
	return linhas && linhas.length > 0 ? Number(linhas[0].id) : -1;
}

/** Quantas linhas a escala tem AGORA — a asserção que prova "permaneceu intacta". */
function quantosItens(escalaId: number): number {
	const r = queryD1Local<{ n: number }>(
		`SELECT COUNT(*) AS n FROM escala_policiais WHERE escala_id = ${escalaId};`
	);
	return Number(r?.[0]?.n ?? -1);
}

async function postForm(request: APIRequestContext, path: string, form: Record<string, string>) {
	return request.post(path, { headers: headersFormAction(token!), form });
}

test.beforeAll(() => {
	token = seedSession(FIXTURE.adminUnidade.id);
	if (!token) return;

	for (const [id, sufixo] of [
		[ESCALA_X, 'X'],
		[ESCALA_Y, 'Y'],
		[ESCALA_ASSINADA, 'Assinada']
	] as const) {
		seedEscala(id, sufixo);
	}
	seedEscala(ESCALA_FINALIZADA, 'Finalizada', 'fds');

	execD1Local(
		`DELETE FROM escala_policiais WHERE escala_id IN (${ESCALA_X}, ${ESCALA_Y}, ${ESCALA_ASSINADA}, ${ESCALA_FINALIZADA});`
	);
	seedItem(ESCALA_X, '2026-11-03');
	seedItem(ESCALA_Y, '2026-11-04');
	seedItem(ESCALA_ASSINADA, '2026-11-05');
	seedItem(ESCALA_FINALIZADA, '2026-11-06');

	// Documento assinado na ESCALA_ASSINADA e `finalizada_em` na de FDS.
	execD1Local(
		`DELETE FROM escala_documentos WHERE escala_id = ${ESCALA_ASSINADA};` +
			`INSERT INTO escala_documentos (escala_id, r2_key, assinante_nome, verificacao_hash) ` +
			`VALUES (${ESCALA_ASSINADA}, 'test/imut-${ESCALA_ASSINADA}.pdf', 'Assinante E2E', 'hash-imut');`
	);
	execD1Local(
		`UPDATE escalas SET finalizada_em = '2026-11-02 10:00:00' WHERE id = ${ESCALA_FINALIZADA};`
	);

	itemDeY = idDoItem(ESCALA_Y);
});

test.afterAll(() => {
	if (!token) return;
	execD1Local(
		`DELETE FROM escala_policiais WHERE escala_id IN (${ESCALA_X}, ${ESCALA_Y}, ${ESCALA_ASSINADA}, ${ESCALA_FINALIZADA});` +
			`DELETE FROM escala_documentos WHERE escala_id = ${ESCALA_ASSINADA};` +
			`DELETE FROM escalas WHERE titulo LIKE '${TITULO}%';`
	);
});

test.describe('FLW-ESC-002 — item de outra escala pelo ID', () => {
	test.describe.configure({ mode: 'serial' });
	test.skip(() => !token, 'D1 local indisponível');

	test('remover: item da escala Y enviado à rota da X é recusado e sobrevive', async ({
		request
	}) => {
		expect(itemDeY, 'seed do item da escala Y falhou').toBeGreaterThan(0);
		const antes = quantosItens(ESCALA_Y);

		const res = await postForm(request, `/escalas/${ESCALA_X}?/remover`, {
			item_id: String(itemDeY)
		});

		expect(await res.text()).toContain('não encontrado nesta escala');
		// O que importa não é a mensagem: é a linha continuar lá.
		expect(quantosItens(ESCALA_Y)).toBe(antes);
	});

	test('editar: idem — a linha da Y não muda de horário pela rota da X', async ({ request }) => {
		const res = await postForm(request, `/escalas/${ESCALA_X}?/editar`, {
			item_id: String(itemDeY),
			data_plantao: '2026-11-04',
			data_saida: '2026-11-04',
			hora_entrada: '23:00',
			hora_saida: '23:59',
			observacoes: 'invadido'
		});

		expect(await res.text()).toContain('não encontrado nesta escala');
		const linha = queryD1Local<{ hora_entrada: string; observacoes: string | null }>(
			`SELECT hora_entrada, observacoes FROM escala_policiais WHERE id = ${itemDeY};`
		)?.[0];
		expect(linha?.hora_entrada).toBe('08:00');
		expect(linha?.observacoes).not.toBe('invadido');
	});

	test('editarPlantaoAgrupado: id de outra escala não é aceito como origem', async ({
		request
	}) => {
		const antes = quantosItens(ESCALA_Y);

		const res = await postForm(request, `/escalas/${ESCALA_X}?/editarPlantaoAgrupado`, {
			ids: JSON.stringify([itemDeY]),
			datas: JSON.stringify(['2026-11-10']),
			hora_entrada: '08:00',
			hora_saida: '18:00',
			observacoes: ''
		});

		expect(await res.text()).toContain('não encontrado');
		expect(quantosItens(ESCALA_Y)).toBe(antes);
	});

	test('sanidade: na PRÓPRIA escala a remoção funciona', async ({ request }) => {
		// Sem este caso, os três acima passariam com um guard que recusa tudo.
		const itemDeX = idDoItem(ESCALA_X);
		expect(itemDeX).toBeGreaterThan(0);

		const res = await postForm(request, `/escalas/${ESCALA_X}?/remover`, {
			item_id: String(itemDeX)
		});

		expect(await res.text()).toContain('success');
		expect(quantosItens(ESCALA_X)).toBe(0);
	});
});

test.describe('FLW-ESC-003 — conteúdo travado depois de assinar ou finalizar', () => {
	test.skip(() => !token, 'D1 local indisponível');

	test('escala ASSINADA recusa remoção, e a composição fica intacta', async ({ request }) => {
		const item = idDoItem(ESCALA_ASSINADA);
		expect(item).toBeGreaterThan(0);

		const res = await postForm(request, `/escalas/${ESCALA_ASSINADA}?/remover`, {
			item_id: String(item)
		});

		expect(await res.text()).toContain('Revogue a assinatura');
		expect(quantosItens(ESCALA_ASSINADA)).toBe(1);
	});

	test('escala ASSINADA recusa adição de servidor', async ({ request }) => {
		const res = await postForm(request, `/escalas/${ESCALA_ASSINADA}?/adicionar`, {
			policial_id: String(FIXTURE.policialA.id),
			data_plantao: '2026-11-20',
			hora_entrada: '08:00',
			hora_saida: '18:00'
		});

		expect(await res.text()).toContain('Revogue a assinatura');
		expect(quantosItens(ESCALA_ASSINADA)).toBe(1);
	});

	test('escala FINALIZADA recusa remoção e manda reabrir', async ({ request }) => {
		const item = idDoItem(ESCALA_FINALIZADA);
		expect(item).toBeGreaterThan(0);

		const res = await postForm(request, `/escalas/${ESCALA_FINALIZADA}?/remover`, {
			item_id: String(item)
		});

		expect(await res.text()).toContain('Reabra');
		expect(quantosItens(ESCALA_FINALIZADA)).toBe(1);
	});

	test('reabrir a de FDS destrava a composição — é a saída documentada', async ({ request }) => {
		// A trava não pode ser um beco sem saída: `desfinalizar` é o caminho
		// explícito e auditado que devolve a escala ao estado editável.
		const reabrir = await postForm(request, `/escalas/${ESCALA_FINALIZADA}?/desfinalizar`, {});
		expect(await reabrir.text()).toContain('success');

		const item = idDoItem(ESCALA_FINALIZADA);
		const res = await postForm(request, `/escalas/${ESCALA_FINALIZADA}?/remover`, {
			item_id: String(item)
		});
		expect(await res.text()).toContain('success');
		expect(quantosItens(ESCALA_FINALIZADA)).toBe(0);
	});
});
