/**
 * Execução de SQL no D1 local via wrangler `--file`.
 *
 * `--command "..."` quebra no Windows quando o SQL é multilinha ou contém
 * caracteres que o shell interpreta (hash Argon2 com `$`, etc.): o wrangler
 * perde o `--command` e responde "Missing required option --command or --file".
 * Arquivo temporário evita o shell e é o mesmo padrão de `scripts/migrate.ts`.
 */
import { execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function comArquivoSql(sql: string, wranglerArgs: string): string {
	const file = join(tmpdir(), `escalas-e2e-d1-${randomBytes(8).toString('hex')}.sql`);
	writeFileSync(file, sql, 'utf8');
	try {
		return execSync(`npx wrangler d1 execute escalas-db --local ${wranglerArgs} --file="${file}"`, {
			cwd: ROOT,
			stdio: ['pipe', 'pipe', 'pipe']
		}).toString();
	} finally {
		try {
			unlinkSync(file);
		} catch {
			/* ignore */
		}
	}
}

/** Executa SQL no D1 local; `false` quando o wrangler falha. */
export function execD1Local(sql: string): boolean {
	try {
		comArquivoSql(sql, '');
		return true;
	} catch {
		return false;
	}
}

/**
 * Consulta o D1 local e devolve as linhas (`--json`). `null` quando o wrangler
 * falha.
 */
export function queryD1Local<T = Record<string, unknown>>(sql: string): T[] | null {
	try {
		const out = comArquivoSql(sql, '--json');
		const parsed = JSON.parse(out) as Array<{ results?: T[] }>;
		return parsed?.[0]?.results ?? [];
	} catch {
		return null;
	}
}

/**
 * Como `execD1Local`, mas reporta a linha de ERROR do stderr (global-setup).
 * Devolve `{ ok, erro }` sem engolir o diagnóstico.
 */
export function execD1LocalComErro(sql: string): { ok: boolean; erro?: string } {
	try {
		comArquivoSql(sql, '');
		return { ok: true };
	} catch (err) {
		const bruto = String(
			(err as { stderr?: Buffer }).stderr ?? (err as Error).message ?? ''
		).replace(/\u001b\[[0-9;]*m/g, '');
		const linha = bruto.split('\n').find((l) => l.includes('ERROR')) ?? bruto.slice(0, 200);
		return { ok: false, erro: linha.trim() };
	}
}
