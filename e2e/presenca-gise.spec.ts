import { test, expect } from '@playwright/test';
import { FIXTURE } from './global-setup';
import {
	seedSession,
	seedDesafioAssinatura,
	seedReauthAssinatura,
	cookieDeSessao,
	execD1Local,
	queryD1Local,
	BASE_URL
} from './session';

/**
 * Presença GISE em TELA (fluxo avançado, mobile-first) + comprovante — cobre a
 * parte do roteiro 6.2 do TESTING.md que não exige hardware: entrada e saída
 * com evidências (2FA semeado + GPS) via form actions do /res-gise,
 * e o comprovante sob demanda (GET /api/gise/[id]/presenca/termo).
 *
 * As actions são chamadas como o `use:enhance` chamaria (POST form-encoded com
 * header `origin` + `x-sveltekit-action`), com o desafio 2FA semeado no D1 —
 * mesma técnica do assinatura-simples.spec. Fica de fora: câmera/liveness
 * (client-side por decisão de produto) e a presença por Token A3 (validação de
 * janela de horário depende da hora corrente — roteiro manual/QA A3).
 */

const GISE = FIXTURE.gise.id;
const CODIGO = '424242';

/** POST de form action do SvelteKit como o enhance faz (fora de /api, o CSRF é
 *  o check de origin do próprio kit). */
async function postAction(
	request: import('@playwright/test').APIRequestContext,
	token: string,
	action: 'salvarEntrada' | 'salvarSaida',
	form: Record<string, string>
) {
	return request.post(`/res-gise?/${action}`, {
		headers: {
			...cookieDeSessao(token),
			origin: BASE_URL,
			'x-sveltekit-action': 'true'
		},
		form
	});
}

let token: string | null = null;

test.beforeAll(() => {
	// Presença limpa a cada suíte (o global-setup também limpa, mas este spec
	// pode rodar isolado via --grep).
	execD1Local(`DELETE FROM gise_presencas WHERE gise_id = ${GISE};`);
	token = seedSession(FIXTURE.membroGise.id);
});

test.describe('Presença GISE em tela + comprovante', () => {
	test.describe.configure({ mode: 'serial' });
	test.skip(() => !token, 'D1 local indisponível — seed de sessão falhou');

	test('sem código 2FA → falha (é sempre obrigatório)', async ({ request }) => {
		const reauthId = seedReauthAssinatura(FIXTURE.membroGise.id, token!);
		test.skip(!reauthId, 'D1 local indisponível');
		const res = await postAction(request, token!, 'salvarEntrada', {
			giseId: String(GISE),
			reauthId: reauthId!
		});
		expect(await res.text()).toContain('obrigat');
	});

	test('comprovante antes da presença → 404', async ({ request }) => {
		const res = await request.get(`/api/gise/${GISE}/presenca/termo?tipo=entrada`, {
			headers: cookieDeSessao(token!)
		});
		expect(res.status()).toBe(404);
	});

	test('entrada com 2FA + GPS → registrada e auditável no comprovante', async ({ request }) => {
		const desafioId = seedDesafioAssinatura(FIXTURE.membroGise.id, CODIGO);
		const reauthId = seedReauthAssinatura(FIXTURE.membroGise.id, token!);
		test.skip(!desafioId || !reauthId, 'D1 local indisponível');

		const res = await postAction(request, token!, 'salvarEntrada', {
			giseId: String(GISE),
			latitude: '-3.7319',
			longitude: '-38.5267',
			codigoEmail: CODIGO,
			desafioId: desafioId!,
			reauthId: reauthId!
		});
		expect(res.status()).toBe(200);
		expect(await res.text()).toContain('success');

		// Comprovante AVANÇADO gerado sob demanda a partir das evidências.
		const termo = await request.get(`/api/gise/${GISE}/presenca/termo?tipo=entrada`, {
			headers: cookieDeSessao(token!)
		});
		expect(termo.status(), await termo.text().catch(() => '')).toBe(200);
		expect(termo.headers()['content-type']).toContain('application/pdf');
		expect((await termo.body()).subarray(0, 5).toString()).toBe('%PDF-');
	});

	test('comprovante de saída antes da saída → 404', async ({ request }) => {
		const res = await request.get(`/api/gise/${GISE}/presenca/termo?tipo=saida`, {
			headers: cookieDeSessao(token!)
		});
		expect(res.status()).toBe(404);
	});

	test('saída com 2FA → registrada, comprovante disponível', async ({ request }) => {
		const desafioId = seedDesafioAssinatura(FIXTURE.membroGise.id, CODIGO);
		const reauthId = seedReauthAssinatura(FIXTURE.membroGise.id, token!);
		test.skip(!desafioId || !reauthId, 'D1 local indisponível');

		const res = await postAction(request, token!, 'salvarSaida', {
			giseId: String(GISE),
			codigoEmail: CODIGO,
			desafioId: desafioId!,
			reauthId: reauthId!
		});
		expect(res.status()).toBe(200);
		expect(await res.text()).toContain('success');

		const termo = await request.get(`/api/gise/${GISE}/presenca/termo?tipo=saida`, {
			headers: cookieDeSessao(token!)
		});
		expect(termo.status()).toBe(200);
		expect((await termo.body()).subarray(0, 5).toString()).toBe('%PDF-');
	});

	test('não-participante com 2FA válido → 403 (vínculo é exigido na escrita)', async ({
		request
	}) => {
		// policialA é conta legítima (sessão + termo aceito) mas NÃO participa da
		// GISE fixture. Passa pelo 2FA (desafio próprio) e ainda assim a action
		// deve recusar por vínculo — antes desta guarda, gravava presença alheia.
		const tokenForasteiro = seedSession(FIXTURE.policialA.id);
		const desafioForasteiro = seedDesafioAssinatura(FIXTURE.policialA.id, CODIGO);
		const reauthForasteiro = tokenForasteiro
			? seedReauthAssinatura(FIXTURE.policialA.id, tokenForasteiro)
			: null;
		test.skip(!tokenForasteiro || !desafioForasteiro || !reauthForasteiro, 'D1 local indisponível');

		const res = await postAction(request, tokenForasteiro!, 'salvarEntrada', {
			giseId: String(GISE),
			codigoEmail: CODIGO,
			desafioId: desafioForasteiro!,
			reauthId: reauthForasteiro!
		});
		const body = await res.text();
		expect(body).toContain('não participa');
		expect(body).not.toContain('"success":1');
	});

	test('guardas do comprovante: anônimo 401, não-participante 403, tipo inválido 400', async ({
		request
	}) => {
		const anon = await request.get(`/api/gise/${GISE}/presenca/termo?tipo=entrada`);
		expect(anon.status()).toBe(401);

		const tokenForasteiro = seedSession(FIXTURE.policialA.id);
		test.skip(!tokenForasteiro, 'D1 local indisponível');
		const forasteiro = await request.get(`/api/gise/${GISE}/presenca/termo?tipo=entrada`, {
			headers: cookieDeSessao(tokenForasteiro!)
		});
		expect(forasteiro.status()).toBe(403);

		const tipoInvalido = await request.get(`/api/gise/${GISE}/presenca/termo?tipo=x`, {
			headers: cookieDeSessao(token!)
		});
		expect(tipoInvalido.status()).toBe(400);
	});
});

/** Calendário civil em Brasília — o mesmo critério de `horarioGiseLiberado`. */
function diaBrasiliaISO(offsetDias: number): string {
	const ms = Date.now() + offsetDias * 86_400_000;
	return new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

function semearGisePresenca(id: number, dataInicio: string, status: string): boolean {
	return execD1Local(
		`DELETE FROM gise_presencas WHERE gise_id=${id};
		 DELETE FROM gise_membros WHERE equipe_id=${id};
		 DELETE FROM gise_equipes WHERE id=${id};
		 DELETE FROM gise_seccionais WHERE id=${id};
		 DELETE FROM gise_escalas WHERE id=${id};

		 INSERT INTO gise_escalas (id, data_inicio, status, hora_entrada, hora_saida, supervisor_id)
		 VALUES (${id}, '${dataInicio}', '${status}', '08:00', '16:00', ${FIXTURE.supervisor.id});

		 INSERT INTO gise_seccionais (id, gise_id, seccional_id, status, hora_entrada, hora_saida)
		 VALUES (${id}, ${id}, ${FIXTURE.seccional.id}, 'preenchida', '08:00', '16:00');

		 INSERT INTO gise_equipes (id, gise_seccional_id, tipo, slots_dpc, slots_oip)
		 VALUES (${id}, ${id}, 'operacional', 1, 1);

		 INSERT INTO gise_membros (equipe_id, policial_id, gise_id)
		 VALUES (${id}, ${FIXTURE.membroGise.id}, ${id});`
	);
}

function limparGisePresenca(id: number): void {
	execD1Local(
		`DELETE FROM gise_presencas WHERE gise_id=${id};
		 DELETE FROM gise_membros WHERE equipe_id=${id};
		 DELETE FROM gise_equipes WHERE id=${id};
		 DELETE FROM gise_seccionais WHERE id=${id};
		 DELETE FROM gise_escalas WHERE id=${id};`
	);
}

function presencasDa(giseId: number): number {
	return Number(
		queryD1Local<{ n: number }>(
			`SELECT COUNT(*) AS n FROM gise_presencas WHERE gise_id=${giseId}`
		)?.[0]?.n ?? -1
	);
}

test.describe('FLW-AUT-006 / 007 — janela e GISE finalizada no /res-gise', () => {
	const GISE_FUTURA = 99501;
	const GISE_FECHADA = 99502;

	test.afterAll(() => {
		limparGisePresenca(GISE_FUTURA);
		limparGisePresenca(GISE_FECHADA);
	});

	test('entrada antes do horário → 409 e nada gravado (FLW-AUT-006)', async ({ request }) => {
		test.skip(!token, 'D1 local indisponível');
		test.skip(!semearGisePresenca(GISE_FUTURA, diaBrasiliaISO(1), 'em_andamento'), 'seed falhou');

		const desafioId = seedDesafioAssinatura(FIXTURE.membroGise.id, CODIGO);
		const reauthId = seedReauthAssinatura(FIXTURE.membroGise.id, token!);
		test.skip(!desafioId || !reauthId, 'D1 local indisponível');

		const res = await postAction(request, token!, 'salvarEntrada', {
			giseId: String(GISE_FUTURA),
			codigoEmail: CODIGO,
			desafioId: desafioId!,
			reauthId: reauthId!
		});
		const body = await res.text();
		expect(body, `status=${res.status()} body=${body}`).toMatch(/ainda não está liberada/i);
		expect(body).not.toContain('"success":1');
		expect(presencasDa(GISE_FUTURA)).toBe(0);
	});

	test('entrada em GISE finalizada → 409 e nada gravado (FLW-AUT-007)', async ({ request }) => {
		test.skip(!token, 'D1 local indisponível');
		test.skip(!semearGisePresenca(GISE_FECHADA, diaBrasiliaISO(-1), 'finalizada'), 'seed falhou');

		const desafioId = seedDesafioAssinatura(FIXTURE.membroGise.id, CODIGO);
		const reauthId = seedReauthAssinatura(FIXTURE.membroGise.id, token!);
		test.skip(!desafioId || !reauthId, 'D1 local indisponível');

		const res = await postAction(request, token!, 'salvarEntrada', {
			giseId: String(GISE_FECHADA),
			codigoEmail: CODIGO,
			desafioId: desafioId!,
			reauthId: reauthId!
		});
		const body = await res.text();
		expect(body, `status=${res.status()} body=${body}`).toMatch(/finalizada/i);
		expect(body).not.toContain('"success":1');
		expect(presencasDa(GISE_FECHADA)).toBe(0);
	});
});
