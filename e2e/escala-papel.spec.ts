/**
 * Editar a escala da própria unidade exige PAPEL — FLW-ESC-001.
 *
 * O servidor exigia só a lotação: qualquer policial lotado na unidade, sem
 * papel administrativo, montava e assinava a escala dela por POST direto.
 *
 * A tela já calculava a regra estrita — `podeEditarEscala && (podeOIPSolicitar
 * || papel administrativo com cargo DPC)` — e a usava em UM dos sete
 * componentes de edição; os outros seis recebiam a flag larga. A regra estava
 * certa e escrita; faltava ser a mesma nos sete lugares e no servidor.
 *
 * `policialA` é exatamente o caso: mora na unidade A, `papel = NULL`. O spec de
 * autorização negativa não cobre isto — lá o ator é de OUTRA unidade, e a
 * recusa vem do gate de lotação, que sempre existiu. Aqui a lotação CONFERE, e
 * o que precisa recusar é a falta de papel.
 */
import { test, expect, request as contextoDeApi } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { FIXTURE } from './global-setup';
import { BASE_URL, execD1Local, queryD1Local, seedSession, headersFormAction } from './session';

const ESCALA = FIXTURE.escalaAssinavel.id;

async function postAction(url: string, token: string, campos: Record<string, string>) {
	const ctx: APIRequestContext = await contextoDeApi.newContext({ baseURL: BASE_URL });
	try {
		const res = await ctx.post(url, { headers: headersFormAction(token), multipart: campos });
		return (await res.json()) as { type?: string; status?: number; data?: string };
	} finally {
		await ctx.dispose();
	}
}

const membrosDa = (escalaId: number) =>
	queryD1Local<{ n: number }>(
		`SELECT COUNT(*) AS n FROM escala_policiais WHERE escala_id=${escalaId}`
	)?.[0]?.n;

test.describe.configure({ mode: 'serial' });

test.describe('FLW-ESC-001 — mesma lotação não basta', () => {
	test('policial SEM papel, da mesma unidade, é recusado nas actions de conteúdo', async () => {
		const token = seedSession(FIXTURE.policialA.id, 'policial');
		test.skip(!token, 'D1 local indisponível');

		// Confere a premissa antes de medir: se a fixture ganhasse papel, o teste
		// passaria a exercer outra coisa e continuaria verde.
		const papel = queryD1Local<{ papel: string | null }>(
			`SELECT papel FROM policiais WHERE id=${FIXTURE.policialA.id}`
		)?.[0]?.papel;
		expect(papel, 'a fixture precisa continuar sem papel administrativo').toBeFalsy();

		const antes = membrosDa(ESCALA);

		for (const [acao, campos] of [
			['adicionar', { policial_id: String(FIXTURE.policialA.id), data: '2026-02-10' }],
			['removerTodos', {}],
			['finalizar', {}]
		] as const) {
			const corpo = await postAction(`/escalas/${ESCALA}?/${acao}`, token!, campos);
			expect(corpo.type, `${acao} → ${JSON.stringify(corpo)}`).toBe('failure');
			expect(corpo.status, `${acao} deve ser 403`).toBe(403);
		}

		expect(membrosDa(ESCALA), 'nenhuma das tentativas pode ter alterado a escala').toBe(antes);
	});

	test('admin de unidade, na mesma lotação, continua editando', async () => {
		// A outra metade: apertar o gate não pode ter fechado a porta de quem TEM
		// papel. Sem este caso, "recusa todo mundo" passaria no teste acima.
		const token = seedSession(FIXTURE.adminUnidade.id, 'policial');
		test.skip(!token, 'D1 local indisponível');

		const corpo = await postAction(`/escalas/${ESCALA}?/adicionar`, token!, {
			policial_id: String(FIXTURE.policialB.id),
			data: '2026-02-11'
		});
		// Pode falhar por validação de dados da action, mas NUNCA por permissão.
		expect(corpo.status, `resposta: ${JSON.stringify(corpo)}`).not.toBe(403);
	});
});

test.afterAll(() => {
	execD1Local(
		`DELETE FROM escala_policiais WHERE escala_id=${ESCALA} AND policial_id=${FIXTURE.policialB.id}`
	);
});
