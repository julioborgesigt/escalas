/**
 * Sobe o servidor para a suíte E2E (comando do `webServer` do Playwright).
 *
 * Diferente de `npm run build && npm run preview`, este wrapper:
 *   1. regenera a CA de TESTE (e2e/ca-teste/artefatos/) — chaves novas a cada
 *      suíte, nunca versionadas;
 *   2. garante um SYNC_TOKEN de teste em `.dev.vars` (não-destrutivo) para os
 *      contract tests dos webhooks — o adapter Cloudflare expõe `.dev.vars` em
 *      `platform.env` via getPlatformProxy, mesma origem do D1 local;
 *   3. builda com `E2E_TEST_CA=1`, o que inlina a raiz de teste no trust store
 *      ICP-Brasil via `define` do Vite (vide vite.config.ts) — habilita o spec
 *      do fluxo A3 qualificado sem tocar o build de produção;
 *   4. serve o preview na porta 4173.
 *
 * Processo único e cross-platform (sem `VAR=x cmd`, que quebra no Windows).
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { gerarArtefatos } from './ca-teste/gerar-ca';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Fixo (só de teste; `.dev.vars` é gitignored) e ≥ 32 chars (SYNC_TOKEN_MIN_LEN). */
const TEST_SYNC_TOKEN = 'e2e-sync-token-0123456789abcdef0123456789';

/**
 * Garante SYNC_TOKEN em `.dev.vars` sem destruir um arquivo de dev existente:
 * preserva o token já configurado (só o publica para a spec) ou acrescenta o de
 * teste quando ausente. Publica o valor efetivo em `e2e/.webhook-token`.
 */
function garantirTokenWebhook(): void {
	const devVars = join(ROOT, '.dev.vars');
	const tokenFile = join(ROOT, 'e2e', '.webhook-token');
	let token = TEST_SYNC_TOKEN;

	if (existsSync(devVars)) {
		const conteudo = readFileSync(devVars, 'utf8');
		const m = conteudo.match(/^\s*SYNC_TOKEN\s*=\s*(.+)$/m);
		if (m) {
			token = m[1].trim().replace(/^["']|["']$/g, ''); // usa o token do dev
		} else {
			writeFileSync(devVars, conteudo.replace(/\s*$/, '') + `\nSYNC_TOKEN=${token}\n`);
		}
	} else {
		writeFileSync(devVars, `SYNC_TOKEN=${token}\n`);
	}
	writeFileSync(tokenFile, token);
}

gerarArtefatos();
garantirTokenWebhook();

execSync('npm run build', {
	cwd: ROOT,
	stdio: 'inherit',
	env: { ...process.env, E2E_TEST_CA: '1' }
});

execSync('npm run preview', { cwd: ROOT, stdio: 'inherit' });
