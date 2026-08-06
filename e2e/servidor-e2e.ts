/**
 * Sobe o servidor para a suíte E2E (comando do `webServer` do Playwright).
 *
 * Diferente de `npm run build && npm run preview`, este wrapper:
 *   1. regenera a CA de TESTE (e2e/ca-teste/artefatos/) — chaves novas a cada
 *      suíte, nunca versionadas;
 *   2. garante SYNC_TOKEN e SUPER_ADMIN_LOGIN de teste em `.dev.vars`
 *      (não-destrutivo) para os contract tests dos webhooks e o console de
 *      auditoria — o adapter Cloudflare expõe `.dev.vars` em `platform.env`
 *      via getPlatformProxy, mesma origem do D1 local;
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
/** Precisa bater com FIXTURE.superAdmin.login do global-setup. */
const TEST_SUPER_ADMIN_LOGIN = 'e2e-super-admin';

const DEV_VARS = join(ROOT, '.dev.vars');

/**
 * Garante `chave=valor` no `.dev.vars` SEM destruir um arquivo de dev existente:
 * preserva o valor já configurado (não sobrescreve) e só acrescenta o de teste
 * quando ausente. Devolve o valor EFETIVO (o do dev, se houver).
 */
function garantirDevVar(chave: string, valorTeste: string): string {
	const conteudo = existsSync(DEV_VARS) ? readFileSync(DEV_VARS, 'utf8') : '';
	const m = conteudo.match(new RegExp(`^\\s*${chave}\\s*=\\s*(.+)$`, 'm'));
	if (m) return m[1].trim().replace(/^["']|["']$/g, ''); // preserva o do dev
	const prefixo = conteudo ? conteudo.replace(/\s*$/, '') + '\n' : '';
	writeFileSync(DEV_VARS, `${prefixo}${chave}=${valorTeste}\n`);
	return valorTeste;
}

/** Sobrescreve (ou cria) a chave — usado só para flags de contrato do E2E. */
function forcarDevVar(chave: string, valor: string): void {
	const conteudo = existsSync(DEV_VARS) ? readFileSync(DEV_VARS, 'utf8') : '';
	const linha = `${chave}=${valor}`;
	const re = new RegExp(`^\\s*${chave}\\s*=.*$`, 'm');
	if (re.test(conteudo)) {
		writeFileSync(DEV_VARS, conteudo.replace(re, linha));
	} else {
		const prefixo = conteudo ? conteudo.replace(/\s*$/, '') + '\n' : '';
		writeFileSync(DEV_VARS, `${prefixo}${linha}\n`);
	}
}

gerarArtefatos();
// SYNC_TOKEN dos webhooks: publica o valor efetivo p/ a spec ler.
writeFileSync(join(ROOT, 'e2e', '.webhook-token'), garantirDevVar('SYNC_TOKEN', TEST_SYNC_TOKEN));
// SUPER_ADMIN_LOGIN: se o dev já tiver o seu, o admin fixture (login fixo) não
// vira super admin e o spec de auditoria pula — não sobrescrevemos.
garantirDevVar('SUPER_ADMIN_LOGIN', TEST_SUPER_ADMIN_LOGIN);
// Espelha produção (decisão 1A): e2e exige timestamp+nonce como o Apps Script.
forcarDevVar('WEBHOOK_REPLAY_ENFORCE', '1');

execSync('npm run build', {
	cwd: ROOT,
	stdio: 'inherit',
	env: { ...process.env, E2E_TEST_CA: '1' }
});

execSync('npm run preview', { cwd: ROOT, stdio: 'inherit' });
