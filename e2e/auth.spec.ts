import { test, expect } from '@playwright/test';

test.describe('Autenticação', () => {
	test('redireciona para /login quando não autenticado', async ({ page }) => {
		await page.goto('/');
		await expect(page).toHaveURL(/\/login/);
	});

	test('exibe formulário de login', async ({ page }) => {
		await page.goto('/login');
		await expect(page.locator('input[name="matricula"], input[id="matricula"], input[placeholder*="matrícula" i]').first()).toBeVisible();
		await expect(page.locator('input[type="password"]').first()).toBeVisible();
	});

	test('exibe erro com credenciais inválidas', async ({ page }) => {
		await page.goto('/login');
		await page.fill('input[type="password"]', 'senhaerrada');
		// Procurar campo de matrícula por diferentes seletores possíveis
		const matriculaInput = page.locator('input').first();
		await matriculaInput.fill('99999999');
		await page.click('button[type="submit"]');
		// Deve exibir mensagem de erro
		await expect(page.locator('text=/inválid/i').first()).toBeVisible({ timeout: 5000 });
	});

	test('bloqueia após 5 tentativas (rate limit)', async ({ page }) => {
		await page.goto('/login');
		for (let i = 0; i < 6; i++) {
			const matriculaInput = page.locator('input').first();
			await matriculaInput.fill('99999999');
			await page.fill('input[type="password"]', 'errada');
			await page.click('button[type="submit"]');
			await page.waitForTimeout(500);
		}
		// Após 5+ tentativas, deve exibir mensagem de rate limit
		await expect(page.locator('text=/tentativas/i').first()).toBeVisible({ timeout: 5000 });
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
});

test.describe('Health check', () => {
	test('/api/health responde sem autenticação', async ({ request }) => {
		const response = await request.get('/api/health');
		const body = await response.json();
		expect(body.status).toBeDefined();
		expect(body.checks).toBeDefined();
		expect(body.timestamp).toBeDefined();
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
