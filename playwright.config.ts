import { defineConfig } from '@playwright/test';

export default defineConfig({
	webServer: {
		command: 'npm run build && npm run preview',
		port: 4173,
		reuseExistingServer: !process.env.CI
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
