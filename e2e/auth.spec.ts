import { test, expect, type Page } from '@playwright/test';

const matriculaLocator = (page: Page) =>
	page.locator('input[name="matricula"], input[id="matricula"], input[placeholder*="matrícula" i]').first();

test.describe('Autenticação', () => {
	test('redireciona para /login quando não autenticado', async ({ page }) => {
		await page.goto('/');
		await expect(page).toHaveURL(/\/login/);
	});

	test('exibe formulário de login', async ({ page }) => {
		await page.goto('/login');
		await expect(matriculaLocator(page)).toBeVisible();
		await expect(page.locator('input[type="password"]').first()).toBeVisible();
	});

	test('exibe erro com credenciais inválidas', async ({ page }) => {
		await page.goto('/login');
		await matriculaLocator(page).fill('99999999');
		await page.fill('input[type="password"]', 'senhaerrada');
		await page.click('button[type="submit"]');
		await expect(page.locator('text=/inválid/i').first()).toBeVisible({ timeout: 10000 });
	});

	test('bloqueia após 5 tentativas (rate limit)', async ({ page }) => {
		await page.goto('/login');
		for (let i = 0; i < 6; i++) {
			await matriculaLocator(page).fill('99999999');
			await page.fill('input[type="password"]', 'errada');
			await page.click('button[type="submit"]');
			// Aguarda a resposta do servidor antes de tentar novamente — em CI
			// o D1 local pode ser mais lento que 500ms fixo.
			await page.waitForLoadState('networkidle');
		}
		// Após 5+ tentativas, deve exibir mensagem de rate limit
		await expect(page.locator('text=/tentativas/i').first()).toBeVisible({ timeout: 10000 });
	});
});

test.describe('Rotas protegidas', () => {
	test('API retorna 401 sem autenticação', async ({ request }) => {
		const response = await request.get('/api/policiais');
		expect(response.status()).toBe(401);
		const body = await response.json();
		expect(body.error).toBeDefined();
	});

	test('API GISE retorna 401 sem autenticação', async ({ request }) => {
		const response = await request.get('/api/gise/1');
		expect(response.status()).toBe(401);
	});

	// Regressão da P0.1 da auditoria: GET de documento assinado de escala
	// passou a exigir permissão (verificarPermissaoEscala). Esses testes não
	// validam o gate cross-lotação propriamente dito (precisaria de fixture
	// de login), mas garantem que pelo menos o gate de autenticação
	// continua presente — qualquer regressão que devolva 200 sem cookie
	// quebra o build.
	test('GET /api/escalas/[id]/documento-assinado exige autenticação', async ({ request }) => {
		const response = await request.get('/api/escalas/1/documento-assinado');
		expect(response.status()).toBe(401);
		const body = await response.json();
		expect(body.errorType).toBe('auth_required');
	});

	test('GET /api/gise/[id]/documento-assinado exige autenticação', async ({ request }) => {
		const response = await request.get('/api/gise/1/documento-assinado');
		expect(response.status()).toBe(401);
		const body = await response.json();
		expect(body.errorType).toBe('auth_required');
	});

	test('GET /api/gise/[id]/documento-assinado/info exige autenticação', async ({ request }) => {
		const response = await request.get('/api/gise/1/documento-assinado/info');
		expect(response.status()).toBe(401);
		const body = await response.json();
		expect(body.errorType).toBe('auth_required');
	});

	// Sanity-check do contrato de erro tipado (P0.2 — `errorType` deve estar
	// presente em TODA resposta 4xx/5xx; CI guarda já impede regressão de
	// `json({ error })` mas o E2E confirma de ponta a ponta.
	test('respostas 401 trazem errorType tipado (contrato P0.2)', async ({ request }) => {
		const response = await request.get('/api/policiais');
		const body = await response.json();
		expect(body).toMatchObject({
			error: expect.any(String),
			status: 401,
			errorType: 'auth_required'
		});
	});
});

test.describe('Health check', () => {
	test('/api/health responde sem autenticação (M-6: resposta mínima por default)', async ({ request }) => {
		// Após M-6 da auditoria, a resposta pública é binária — `{ status: ok|down }`.
		// Detalhe estruturado (checks individuais, timestamp) só com
		// `?detail=<HEALTH_DETAIL_TOKEN>` válido, para não vazar topologia
		// interna em reconhecimento. Monitoramento externo (que checa só o
		// status code) continua funcionando.
		const response = await request.get('/api/health');
		expect(response.status()).toBe(200);
		const body = await response.json();
		expect(body.status).toBe('ok');
		// Defesa anti-reconnaissance: NÃO deve vazar estado individual.
		expect(body.checks).toBeUndefined();
		expect(body.timestamp).toBeUndefined();
	});
});

test.describe('Validação pública', () => {
	test('/validar/hash-invalido exibe documento não encontrado', async ({ page }) => {
		await page.goto('/validar/hash-que-nao-existe');
		await expect(page.locator('text=/não encontrado|erro/i').first()).toBeVisible({ timeout: 5000 });
	});
});

test.describe('Security headers', () => {
	test('respostas incluem headers de segurança', async ({ request }) => {
		const response = await request.get('/login');
		expect(response.headers()['x-frame-options']).toBe('DENY');
		expect(response.headers()['x-content-type-options']).toBe('nosniff');
		expect(response.headers()['referrer-policy']).toBe('strict-origin-when-cross-origin');
	});

	test('respostas HTML incluem Content-Security-Policy', async ({ request }) => {
		const response = await request.get('/login');
		const csp = response.headers()['content-security-policy'];
		expect(csp).toBeDefined();
		expect(csp).toContain("script-src 'self'");
		expect(csp).toContain("style-src 'self'");
		expect(csp).toContain('upgrade-insecure-requests');
		expect(csp).toContain('block-all-mixed-content');
	});

	test('respostas API têm CSP restritiva', async ({ request }) => {
		const response = await request.get('/api/health');
		const csp = response.headers()['content-security-policy'];
		expect(csp).toBeDefined();
		expect(csp).toContain("default-src 'none'");
		expect(csp).toContain("form-action 'none'");
	});
});
