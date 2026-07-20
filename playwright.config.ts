import { defineConfig, devices } from '@playwright/test';

// Containers/sandboxes com Chromium pré-instalado fora do cache do Playwright
// (onde `playwright install` é bloqueado): aponte o binário por env. Sem a
// env, o Playwright resolve o browser do jeito padrão (CI usa o install).
const chromiumExe = process.env.PW_CHROMIUM_EXECUTABLE;

export default defineConfig({
	globalSetup: './e2e/global-setup.ts',
	workers: 1,
	webServer: {
		// Wrapper que regenera a CA de teste, builda com E2E_TEST_CA=1 (raiz de
		// teste no trust store — fluxo A3 em CI) e serve o preview. Vide
		// e2e/servidor-e2e.ts. Atenção com reuseExistingServer local: um preview
		// antigo buildado SEM a CA de teste faz o spec A3 falhar com "não encadeia".
		command: 'npx tsx e2e/servidor-e2e.ts',
		port: 4173,
		reuseExistingServer: !process.env.CI,
		/** Cloudflare adapter + bundle pode exceder 60s em máquinas lentas ou CI frio */
		timeout: process.env.CI ? 180_000 : 120_000
	},
	testDir: 'e2e',
	testMatch: '**/*.spec.ts',
	use: {
		baseURL: 'http://localhost:4173',
		screenshot: 'only-on-failure',
		...(chromiumExe ? { launchOptions: { executablePath: chromiumExe } } : {})
	},
	projects: [
		{ name: 'chromium', use: { browserName: 'chromium' } },
		{
			// Fluxos mobile-first (presença GISE, telas do membro) em viewport de
			// celular emulado. Restrito aos specs de UI — os specs de API não
			// ganham nada com viewport e dobrariam a duração da suíte.
			name: 'mobile',
			use: { ...devices['Pixel 7'] },
			// gise.spec fica de fora: suas asserções miram o layout desktop
			// (o card da seccional colapsa/oculta o texto no viewport mobile).
			testMatch: ['**/boas-vindas-rbac.spec.ts', '**/rubrica-aviso.spec.ts']
		}
	]
});
