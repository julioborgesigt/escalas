import { test, expect } from '@playwright/test';
import { FIXTURE } from './global-setup';
import { seedSession, cookieDeSessao, headersDeSessaoMutacao } from './session';

/**
 * Política de assinatura (`/api/configuracoes/assinatura`) — a configuração
 * que decide o NÍVEL jurídico das assinaturas em tela. Três propriedades:
 *
 *   1. RBAC: só o Super Admin altera (Admin Geral → 403; anônimo → 401);
 *   2. INVARIANTE LEGAL: o 2FA por e-mail é requisito mínimo da assinatura
 *      avançada (Lei 14.063/2020 art. 4º II "b") — nem o Super Admin consegue
 *      desligar (PUT `false` → 400) e o GET expõe o motivo em `bloqueados`;
 *   3. CACHE EDGE: o PUT invalida o cache de 5 min — um GET logo depois
 *      precisa refletir o valor novo (se a invalidação quebrar, assinaturas
 *      subsequentes leriam flags velhas por até 5 minutos).
 *
 * O toggle usa `restringirSmartphone` (flag sem efeito nos demais specs, que
 * são API-level) e restaura o valor original ao final do próprio teste.
 */

let tokenSuper: string | null = null;
let tokenAdminGeral: string | null = null;
let ehSuperAdmin = false;

type Flags = {
	exigirFoto: boolean;
	exigirGps: boolean;
	exigirCodigoEmail: boolean;
	restringirSmartphone: boolean;
	bloqueados: Array<{ flag: string; motivo: string }>;
};

test.beforeAll(() => {
	tokenSuper = seedSession(FIXTURE.superAdmin.id, 'admin');
	tokenAdminGeral = seedSession(FIXTURE.adminGeral.id, 'admin');
});

test.describe('Política de assinatura (/conf-ass)', () => {
	test.describe.configure({ mode: 'serial' });
	test.skip(() => !tokenSuper || !tokenAdminGeral, 'D1 local indisponível');

	test('GET expõe as flags e os requisitos legais bloqueados', async ({ request }) => {
		const res = await request.get('/api/configuracoes/assinatura', {
			headers: cookieDeSessao(tokenSuper!)
		});
		expect(res.status()).toBe(200);
		const flags = (await res.json()) as Flags;
		// O 2FA reporta sempre ligado (fonte única) e aparece como bloqueado
		// com a base legal — a UI usa isto para desabilitar o toggle.
		expect(flags.exigirCodigoEmail).toBe(true);
		expect(flags.bloqueados.length).toBeGreaterThan(0);
		expect(flags.bloqueados.some((b) => b.motivo.match(/14\.063|14063/))).toBe(true);
	});

	test('RBAC: anônimo barrado (CSRF antes da auth); Admin Geral (não-super) → 403', async ({
		request
	}) => {
		// Em /api/* o double-submit CSRF roda ANTES da autenticação nos hooks:
		// PUT anônimo sem o par cookie+header cai no 403 de CSRF, nunca chega
		// ao requireSuperAdmin. O importante: mutação anônima é bloqueada.
		const anon = await request.put('/api/configuracoes/assinatura', {
			headers: { 'content-type': 'application/json' },
			data: { restringirSmartphone: true }
		});
		expect(anon.status()).toBe(403);

		const adminGeral = await request.put('/api/configuracoes/assinatura', {
			headers: headersDeSessaoMutacao(tokenAdminGeral!),
			data: { restringirSmartphone: true }
		});
		// Se o ambiente do dev tiver SUPER_ADMIN_LOGIN próprio, o fixture
		// "super" também não é super — aí este PUT retornaria 403 igualmente,
		// sem invalidar a asserção.
		expect(adminGeral.status()).toBe(403);
	});

	test('invariante legal: nem o Super Admin desliga o 2FA (PUT false → 400)', async ({
		request
	}) => {
		const put = await request.put('/api/configuracoes/assinatura', {
			headers: headersDeSessaoMutacao(tokenSuper!),
			data: { exigirCodigoEmail: false }
		});
		test.skip(put.status() === 403, 'fixture não é Super Admin neste ambiente');
		ehSuperAdmin = true;
		expect(put.status()).toBe(400);
		expect((await put.json()).error).toMatch(/requisito legal|14\.063/i);

		// E o GET continua reportando o 2FA ligado.
		const get = await request.get('/api/configuracoes/assinatura', {
			headers: cookieDeSessao(tokenSuper!)
		});
		expect(((await get.json()) as Flags).exigirCodigoEmail).toBe(true);
	});

	test('PUT sem campo válido → 400', async ({ request }) => {
		test.skip(!ehSuperAdmin, 'fixture não é Super Admin neste ambiente');
		const put = await request.put('/api/configuracoes/assinatura', {
			headers: headersDeSessaoMutacao(tokenSuper!),
			data: {}
		});
		expect(put.status()).toBe(400);
		expect((await put.json()).error).toMatch(/nenhum campo/i);
	});

	test('PUT invalida o cache edge: GET reflete a mudança na hora (e restaura)', async ({
		request
	}) => {
		test.skip(!ehSuperAdmin, 'fixture não é Super Admin neste ambiente');
		const headers = headersDeSessaoMutacao(tokenSuper!);
		const lerFlags = async (): Promise<Flags> => {
			const r = await request.get('/api/configuracoes/assinatura', {
				headers: cookieDeSessao(tokenSuper!)
			});
			return (await r.json()) as Flags;
		};

		const original = (await lerFlags()).restringirSmartphone;

		const put = await request.put('/api/configuracoes/assinatura', {
			headers,
			data: { restringirSmartphone: !original }
		});
		expect(put.status(), await put.text().catch(() => '')).toBe(200);
		// Sem esperar o TTL de 5 min: a invalidação explícita precisa bastar.
		expect((await lerFlags()).restringirSmartphone).toBe(!original);

		// Restaura o valor original (novo PUT também re-invalida o cache).
		const restaurar = await request.put('/api/configuracoes/assinatura', {
			headers,
			data: { restringirSmartphone: original }
		});
		expect(restaurar.status()).toBe(200);
		expect((await lerFlags()).restringirSmartphone).toBe(original);
	});
});
