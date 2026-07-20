import { test, expect } from '@playwright/test';
import { FIXTURE } from './global-setup';
import {
	seedSession,
	seedDesafioAssinatura,
	cookieDeSessao,
	execD1Local,
	BASE_URL
} from './session';

/**
 * Presença GISE em TELA (fluxo avançado, mobile-first) + comprovante — cobre a
 * parte do roteiro 6.2 do TESTING.md que não exige hardware: entrada e saída
 * com evidências (rubrica + 2FA semeado + GPS) via form actions do /res-gise,
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
const RUBRICA_PNG =
	'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

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
		const res = await postAction(request, token!, 'salvarEntrada', {
			giseId: String(GISE),
			rubrica: RUBRICA_PNG
		});
		expect(await res.text()).toContain('obrigat');
	});

	test('comprovante antes da presença → 404', async ({ request }) => {
		const res = await request.get(`/api/gise/${GISE}/presenca/termo?tipo=entrada`, {
			headers: cookieDeSessao(token!)
		});
		expect(res.status()).toBe(404);
	});

	test('entrada com rubrica + 2FA + GPS → registrada e auditável no comprovante', async ({
		request
	}) => {
		const desafioId = seedDesafioAssinatura(FIXTURE.membroGise.id, CODIGO);
		test.skip(!desafioId, 'D1 local indisponível');

		const res = await postAction(request, token!, 'salvarEntrada', {
			giseId: String(GISE),
			rubrica: RUBRICA_PNG,
			latitude: '-3.7319',
			longitude: '-38.5267',
			codigoEmail: CODIGO,
			desafioId: desafioId!
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

	test('saída com rubrica + 2FA → registrada, comprovante disponível', async ({ request }) => {
		const desafioId = seedDesafioAssinatura(FIXTURE.membroGise.id, CODIGO);
		test.skip(!desafioId, 'D1 local indisponível');

		const res = await postAction(request, token!, 'salvarSaida', {
			giseId: String(GISE),
			rubrica: RUBRICA_PNG,
			codigoEmail: CODIGO,
			desafioId: desafioId!
		});
		expect(res.status()).toBe(200);
		expect(await res.text()).toContain('success');

		const termo = await request.get(`/api/gise/${GISE}/presenca/termo?tipo=saida`, {
			headers: cookieDeSessao(token!)
		});
		expect(termo.status()).toBe(200);
		expect((await termo.body()).subarray(0, 5).toString()).toBe('%PDF-');
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
