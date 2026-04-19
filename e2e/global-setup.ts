import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * Limpa tentativas de login no D1 local para e2e não herdarem rate limit de execuções anteriores
 * (preview reutiliza o mesmo arquivo de estado com `reuseExistingServer`).
 */
export default async function globalSetup() {
	const root = join(dirname(fileURLToPath(import.meta.url)), '..');
	try {
		execSync('npx wrangler d1 execute escalas-db --local --command "DELETE FROM login_attempts;"', {
			cwd: root,
			stdio: 'pipe'
		});
	} catch {
		// Sem D1 local ou wrangler indisponível — os testes ainda podem passar em CI limpo
	}
}
