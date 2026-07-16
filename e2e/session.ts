import { execSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Page } from '@playwright/test';

/**
 * Sessões SEMEADAS para os testes E2E.
 *
 * O login por senha das contas fixture é bloqueado por design: o 2FA é
 * fail-closed (auth-flow devolve 403 para conta sem e-mail cadastrado) e o
 * runner não tem caixa de entrada para receber código. Em vez de furar o
 * fail-closed, inserimos a linha de sessão diretamente no D1 LOCAL — mesma
 * técnica do seed do global-setup, restrita ao banco de teste.
 *
 * Detalhes que importam:
 *  - `expires_at` PRECISA estar em ISO com `T` (`buscarSessaoValida` compara
 *    strings com `new Date().toISOString()`; o `datetime('now')` do SQLite usa
 *    espaço e NUNCA valida).
 *  - O token vai em claro; o app aceita via fallback de migração e re-grava
 *    hasheado no primeiro uso.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const BASE_URL = 'http://localhost:4173';

/** Executa SQL no D1 local; `false` quando o wrangler não está disponível. */
export function execD1Local(sql: string): boolean {
	try {
		execSync(`npx wrangler d1 execute escalas-db --local --command "${sql.replace(/"/g, '\\"')}"`, {
			cwd: ROOT,
			stdio: 'pipe'
		});
		return true;
	} catch {
		return false;
	}
}

/**
 * Insere uma sessão de 8h para o usuário no D1 local e devolve o token.
 * `null` quando o wrangler/D1 local não está disponível (caller deve pular).
 */
export function seedSession(usuarioId: number, tipo: 'policial' | 'admin' = 'policial') {
	const token = `e2e-${randomBytes(24).toString('hex')}`;
	const sql =
		`INSERT INTO sessoes (token, tipo, usuario_id, expires_at) ` +
		`VALUES ('${token}', '${tipo}', ${usuarioId}, strftime('%Y-%m-%dT%H:%M:%S', 'now', '+8 hours') || '.000Z');`;
	try {
		execSync(`npx wrangler d1 execute escalas-db --local --command "${sql}"`, {
			cwd: ROOT,
			stdio: 'pipe'
		});
		return token;
	} catch {
		return null;
	}
}

/** Header `cookie` para chamadas via APIRequestContext (`request.get(...)`). */
export function cookieDeSessao(token: string): { cookie: string } {
	return { cookie: `session_token=${token}` };
}

/**
 * Headers de sessão + CSRF para POST/PUT/DELETE em /api/* via
 * APIRequestContext. O guard é double-submit puro (hooks.server compara o
 * header `x-csrf-token` com o cookie `__csrf`), então um token inventado
 * aqui é válido desde que apareça nos dois lados.
 */
export function headersDeSessaoMutacao(token: string): Record<string, string> {
	const csrf = randomBytes(32).toString('hex');
	return {
		cookie: `session_token=${token}; __csrf=${csrf}`,
		'x-csrf-token': csrf
	};
}

/**
 * Semeia um desafio 2FA de ASSINATURA com código conhecido no D1 local e
 * devolve o desafioId (hex puro — o schema Zod rejeita outros formatos).
 *
 * O app guarda `sha256(bindExtra + código)` (ver `hashCodigo2FA` em
 * src/lib/auth.ts); o fluxo de assinatura usa `bindExtra = ''`, então o hash
 * é reprodutível aqui sem depender de caixa de e-mail no runner.
 * `null` quando o wrangler/D1 local não está disponível (caller deve pular).
 */
export function seedDesafioAssinatura(usuarioId: number, codigo: string): string | null {
	const desafioId = randomBytes(20).toString('hex');
	const codigoHash = createHash('sha256').update(codigo).digest('hex');
	const sql =
		`INSERT INTO dois_fatores_tokens (desafio_id, tipo, usuario_id, codigo, expires_at) ` +
		`VALUES ('${desafioId}', 'assinatura', ${usuarioId}, '${codigoHash}', ` +
		`strftime('%Y-%m-%dT%H:%M:%S', 'now', '+10 minutes') || '.000Z');`;
	return execD1Local(sql) ? desafioId : null;
}

/**
 * Semeia a sessão e injeta o cookie no contexto da página.
 * Devolve `false` quando o D1 local está indisponível (caller deve pular).
 */
export async function autenticarPagina(
	page: Page,
	usuarioId: number,
	tipo: 'policial' | 'admin' = 'policial'
): Promise<boolean> {
	const token = seedSession(usuarioId, tipo);
	if (!token) return false;
	await page.context().addCookies([{ name: 'session_token', value: token, url: BASE_URL }]);
	return true;
}
