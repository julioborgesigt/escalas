import { test, expect } from '@playwright/test';
import { execD1Local, queryD1Local, tokenWebhookE2E, headersWebhookE2E } from './session';

/**
 * Contract tests dos webhooks de sync (`/api/webhook/*`) — o ponto onde código
 * versionado (scripts/GoogleAppsScript_Sync.gs) executa FORA do repo. Garante
 * que o endpoint aceita o payload que o Apps Script envia, faz upsert correto e
 * mantém as guardas de segurança contra um SYNC_TOKEN comprometido.
 *
 * A autenticação (Bearer/HMAC/replay) em si tem cobertura unitária em
 * webhook-auth.test.ts; aqui exercitamos o CONTRATO ponta a ponta contra o D1
 * real (upsert observável via queryD1Local) e as propriedades que só o handler
 * de rota expressa: M-4 (webhook não promove a admin) e o fail-closed do reset.
 *
 * O SYNC_TOKEN de teste é injetado em `.dev.vars` pelo servidor-e2e (o adapter
 * Cloudflare o expõe em platform.env); a spec lê o valor efetivo do arquivo
 * publicado. Com `WEBHOOK_REPLAY_ENFORCE=1` (forçado no e2e como em produção),
 * as chamadas autenticadas levam timestamp+nonce — igual ao `sendToAPI` do GAS.
 */

const SYNC = tokenWebhookE2E();

const MAT = 'WEBHOOKE2E01';
const MAT_ADMIN = 'WEBHOOKE2E02';
const MAT_BAD = 'WEBHOOKE2E03';
const MAT_LOTE_OK = 'WEBHOOKE2E04';
const MAT_INATIVO = 'WEBHOOKE2E05';
const SECCIONAL = 'SECCIONAL WEBHOOK E2E';

const hdr = (t: string, extra?: Record<string, string>) => headersWebhookE2E(t, extra);

test.describe('Webhook sync — contrato + segurança', () => {
	test.skip(() => !SYNC, 'SYNC_TOKEN/D1 local indisponível');

	test.afterAll(() => {
		execD1Local(
			`DELETE FROM policiais WHERE matricula IN ('${MAT}', '${MAT_ADMIN}', '${MAT_BAD}', '${MAT_LOTE_OK}', '${MAT_INATIVO}'); ` +
				`DELETE FROM unidades WHERE nome = '${SECCIONAL}';`
		);
	});

	test('sem Authorization → 401', async ({ request }) => {
		const res = await request.post('/api/webhook/sync-policiais', {
			headers: { 'content-type': 'application/json' },
			data: { matricula: MAT, nome: 'X', cargo: 'OIP' }
		});
		expect(res.status()).toBe(401);
	});

	test('Bearer inválido → 401', async ({ request }) => {
		const res = await request.post('/api/webhook/sync-policiais', {
			headers: hdr('token-errado-que-nao-bate-com-nada-1234'),
			data: { matricula: MAT, nome: 'X', cargo: 'OIP' }
		});
		expect(res.status()).toBe(401);
	});

	test('Bearer válido sem timestamp/nonce → 401 (WEBHOOK_REPLAY_ENFORCE)', async ({ request }) => {
		const res = await request.post('/api/webhook/sync-policiais', {
			headers: {
				Authorization: `Bearer ${SYNC!}`,
				'content-type': 'application/json'
			},
			data: { matricula: MAT, nome: 'X', cargo: 'OIP' }
		});
		expect(res.status()).toBe(401);
	});

	test('mesmo nonce duas vezes → 401 (replay)', async ({ request }) => {
		const nonce = `e2e-replay-${Date.now()}`;
		const ts = String(Math.floor(Date.now() / 1000));
		const headers = {
			Authorization: `Bearer ${SYNC!}`,
			'content-type': 'application/json',
			'X-Webhook-Timestamp': ts,
			'X-Webhook-Nonce': nonce
		};
		const data = {
			matricula: MAT,
			nome: 'Replay Probe',
			cargo: 'OIP',
			lotacao: 'DELEGACIA E2E FIXTURE A'
		};
		const a = await request.post('/api/webhook/sync-policiais', { headers, data });
		expect(a.status()).toBe(200);
		const b = await request.post('/api/webhook/sync-policiais', { headers, data });
		expect(b.status()).toBe(401);
	});

	test('payload do Apps Script cria e depois atualiza o policial (upsert)', async ({ request }) => {
		// CREATE
		const criar = await request.post('/api/webhook/sync-policiais', {
			headers: hdr(SYNC!),
			data: {
				matricula: MAT,
				nome: 'Fulano Webhook',
				cargo: 'OIP',
				lotacao: 'DELEGACIA E2E FIXTURE A',
				telefone: '(85) 99999-9999',
				email: 'fulano.webhook@example.com',
				regime: 'plantao'
			}
		});
		expect(criar.status(), await criar.text().catch(() => '')).toBe(200);
		expect(await criar.json()).toMatchObject({ success: true, imported: 1, failed: 0 });

		const apos = queryD1Local<{ nome: string; cargo: string }>(
			`SELECT nome, cargo FROM policiais WHERE matricula='${MAT}'`
		);
		expect(apos?.[0]?.nome).toBe('Fulano Webhook');
		expect(apos?.[0]?.cargo).toBe('OIP');

		// UPDATE (mesma matrícula, nome e cargo novos)
		const atualizar = await request.post('/api/webhook/sync-policiais', {
			headers: hdr(SYNC!),
			data: {
				matricula: MAT,
				nome: 'Fulano Atualizado',
				cargo: 'DPC',
				lotacao: 'DELEGACIA E2E FIXTURE A'
			}
		});
		expect((await atualizar.json()).imported).toBe(1);

		const depois = queryD1Local<{ nome: string; cargo: string }>(
			`SELECT nome, cargo FROM policiais WHERE matricula='${MAT}'`
		);
		expect(depois?.[0]?.nome).toBe('Fulano Atualizado');
		expect(depois?.[0]?.cargo).toBe('DPC');
	});

	test('cargo inválido → a linha falha, o lote NÃO cai, e a resposta é 422', async ({
		request
	}) => {
		// Lote MISTO, que é o que o nome do teste promete: a linha boa entra, a
		// ruim não, e nenhuma das duas derruba a outra.
		const res = await request.post('/api/webhook/sync-policiais', {
			headers: hdr(SYNC!),
			data: [
				{
					matricula: MAT_LOTE_OK,
					nome: 'Linha Boa',
					cargo: 'OIP',
					lotacao: 'DELEGACIA E2E FIXTURE A'
				},
				{ matricula: MAT_BAD, nome: 'Cargo Ruim', cargo: 'GENERAL', lotacao: 'X' }
			]
		});

		// 422, não 200 (FLW-WEBHOOK-002): o Apps Script lê `error`/`details` e
		// ignora `errors`, então um sucesso PARCIAL respondido como 200 chegava do
		// outro lado como "sincronizou" — e o policial simplesmente não estava lá.
		// Não dá para corrigir o script daqui; dá para parar de dizer OK.
		expect(res.status()).toBe(422);
		const j = await res.json();
		expect(j.imported).toBe(1);
		expect(j.failed).toBe(1);
		expect(j.errors?.length).toBe(1);

		// A boa entrou...
		expect(queryD1Local(`SELECT id FROM policiais WHERE matricula='${MAT_LOTE_OK}'`)?.length).toBe(
			1
		);
		// ...e a ruim não.
		expect(queryD1Local(`SELECT id FROM policiais WHERE matricula='${MAT_BAD}'`)?.length).toBe(0);
	});

	test('lote inteiro válido → 200', async ({ request }) => {
		// O par do teste acima: sem falha nenhuma o status volta a ser 200, senão
		// o 422 viraria ruído permanente e o operador aprenderia a ignorá-lo.
		const res = await request.post('/api/webhook/sync-policiais', {
			headers: hdr(SYNC!),
			data: [
				{
					matricula: MAT_LOTE_OK,
					nome: 'Linha Boa',
					cargo: 'OIP',
					lotacao: 'DELEGACIA E2E FIXTURE A'
				}
			]
		});
		expect(res.status()).toBe(200);
		expect(await res.json()).toMatchObject({ imported: 1, failed: 0 });
	});

	test('M-4: payload NÃO promove a admin (WEBHOOK_ALLOW_PAPEL_CHANGES desligado)', async ({
		request
	}) => {
		const res = await request.post('/api/webhook/sync-policiais', {
			headers: hdr(SYNC!),
			data: {
				matricula: MAT_ADMIN,
				nome: 'Tentativa Escalada',
				cargo: 'DPC',
				lotacao: 'DELEGACIA E2E FIXTURE A',
				papel: 'seccional',
				papel_unidade: 'DELEGACIA E2E FIXTURE A'
			}
		});
		expect(res.status()).toBe(200);
		expect(await res.json()).toMatchObject({ imported: 1 });

		// O policial foi criado, MAS sem papel administrativo: SYNC_TOKEN
		// comprometido não consegue promover ninguém (safe-default M-4).
		const rows = queryD1Local<{ papel: string | null }>(
			`SELECT papel FROM policiais WHERE matricula='${MAT_ADMIN}'`
		);
		expect(rows?.[0]?.papel).toBeNull();
	});

	test('sync de existente NÃO reativa ativo=0 (FLW-AUT-005)', async ({ request }) => {
		const payload = {
			matricula: MAT_INATIVO,
			nome: 'Inativo Webhook',
			cargo: 'OIP',
			lotacao: 'DELEGACIA E2E FIXTURE A'
		};
		const criar = await request.post('/api/webhook/sync-policiais', {
			headers: hdr(SYNC!),
			data: payload
		});
		expect(criar.status(), await criar.text().catch(() => '')).toBe(200);

		expect(execD1Local(`UPDATE policiais SET ativo=0 WHERE matricula='${MAT_INATIVO}'`)).toBe(true);
		expect(
			queryD1Local<{ ativo: number }>(
				`SELECT ativo FROM policiais WHERE matricula='${MAT_INATIVO}'`
			)?.[0]?.ativo
		).toBe(0);

		const deNovo = await request.post('/api/webhook/sync-policiais', {
			headers: hdr(SYNC!),
			data: { ...payload, nome: 'Inativo Atualizado' }
		});
		expect(deNovo.status()).toBe(200);

		const depois = queryD1Local<{ ativo: number; nome: string }>(
			`SELECT ativo, nome FROM policiais WHERE matricula='${MAT_INATIVO}'`
		)?.[0];
		expect(depois?.nome).toBe('Inativo Atualizado');
		expect(depois?.ativo, 'desativação disciplinar não pode durar só até o próximo sync').toBe(0);
	});

	test('sync-unidades cria a seccional (upsert)', async ({ request }) => {
		const res = await request.post('/api/webhook/sync-unidades', {
			headers: hdr(SYNC!),
			data: { nivel: 'SECCIONAL', seccional: SECCIONAL, cidade: 'Fortaleza' }
		});
		expect(res.status(), await res.text().catch(() => '')).toBe(200);

		const rows = queryD1Local<{ tipo: string }>(
			`SELECT tipo FROM unidades WHERE nome='${SECCIONAL}'`
		);
		expect(rows?.[0]?.tipo).toBe('seccional');
	});

	test('reset destrutivo exige 2ª credencial: SYNC válido + reset token errado → 401', async ({
		request
	}) => {
		const antes = queryD1Local<{ n: number }>(
			`SELECT COUNT(*) as n FROM policiais WHERE id BETWEEN 99000 AND 99999`
		);
		const totalAntes = Number(antes?.[0]?.n ?? 0);
		expect(totalAntes).toBeGreaterThan(0);

		const res = await request.post('/api/webhook/reset-policiais', {
			headers: hdr(SYNC!, {
				'X-Reset-Token': 'nao-e-o-reset-token-correto-000000000000',
				// Data UTC corrente (a 3ª credencial) — irrelevante para o 401 deste
				// caso (RESET_TOKEN ausente/errado falha antes), mas mantida realista.
				'X-Confirm-Reset': new Date().toISOString().slice(0, 10)
			}),
			data: {}
		});
		expect(res.status()).toBe(401);

		// Nada foi apagado.
		const depois = queryD1Local<{ n: number }>(
			`SELECT COUNT(*) as n FROM policiais WHERE id BETWEEN 99000 AND 99999`
		);
		expect(Number(depois?.[0]?.n ?? 0)).toBe(totalAntes);
	});
});
