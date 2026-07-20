/**
 * Sobe o servidor para a suíte E2E (comando do `webServer` do Playwright).
 *
 * Diferente de `npm run build && npm run preview`, este wrapper:
 *   1. regenera a CA de TESTE (e2e/ca-teste/artefatos/) — chaves novas a cada
 *      suíte, nunca versionadas;
 *   2. builda com `E2E_TEST_CA=1`, o que inlina a raiz de teste no trust store
 *      ICP-Brasil via `define` do Vite (vide vite.config.ts) — habilita o spec
 *      do fluxo A3 qualificado sem tocar o build de produção;
 *   3. serve o preview na porta 4173.
 *
 * Processo único e cross-platform (sem `VAR=x cmd`, que quebra no Windows).
 */
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { gerarArtefatos } from './ca-teste/gerar-ca';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

gerarArtefatos();

execSync('npm run build', {
	cwd: ROOT,
	stdio: 'inherit',
	env: { ...process.env, E2E_TEST_CA: '1' }
});

execSync('npm run preview', { cwd: ROOT, stdio: 'inherit' });
