import { defineConfig } from '@playwright/test';

export default defineConfig({
	globalSetup: './e2e/global-setup.ts',
	workers: 1,
	webServer: {
		command: 'npm run build && npm run preview',
		port: 4173,
		reuseExistingServer: !process.env.CI,
		/** Cloudflare adapter + bundle pode exceder 60s em máquinas lentas ou CI frio */
		timeout: process.env.CI ? 180_000 : 120_000
	},
	testDir: 'e2e',
	testMatch: '**/*.spec.ts',
	use: {
		baseURL: 'http://localhost:4173',
		screenshot: 'only-on-failure'
	},
	projects: [
		{ name: 'chromium', use: { browserName: 'chromium' } }
	]
});
