/**
 * Execução de SQL no D1 local via wrangler `--file`.
 *
 * `--command "..."` quebra no Windows quando o SQL é multilinha ou contém
 * caracteres que o shell interpreta (hash Argon2 com `$`, etc.): o wrangler
 * perde o `--command` e responde "Missing required option --command or --file".
 * Arquivo temporário evita o shell e é o mesmo padrão de `scripts/migrate.ts`.
 *
 * Cada chamada spawna um processo `wrangler` novo — a suíte inteira faz isso
 * centenas de vezes. Falha TRANSIENTE de spawn (não de SQL) é rara mas real
 * nesse volume, e antes desta função virava `false`/`null` silencioso: quem
 * chama nem sabia que o processo tinha falhado, só que a query "não achou
 * nada" — foi assim que AUTH-002 falhou em CI recebendo `undefined` de um
 * `COUNT(*)` que nunca devolve linha vazia. `comRetentativa` tenta de novo
 * (a falha do processo não é a mesma coisa que um erro de SQL — repetir não
 * mascara um bug de sintaxe, que falha igual em toda tentativa) e, se todas
 * falharem, imprime a linha de ERROR real em vez de deixar o chamador
 * adivinhar a partir de `false`/`null`.
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

/** Extrai a linha de ERROR do stderr do wrangler (ou os primeiros 200 chars). */
function linhaDeErro(err: unknown): string {
	const bruto = String((err as { stderr?: Buffer }).stderr ?? (err as Error).message ?? '').replace(
		/\u001b\[[0-9;]*m/g,
		''
	);
	return (bruto.split('\n').find((l) => l.includes('ERROR')) ?? bruto.slice(0, 200)).trim();
}

/** Sleep síncrono (sem spawnar processo) — usado só entre retentativas. */
function esperarMs(ms: number): void {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Roda `comArquivoSql` com até 2 retentativas em caso de falha do PROCESSO
 * wrangler (spawn, timeout, etc.) — não existe forma de distinguir isso de
 * um erro de SQL antes de tentar de novo, mas repetir uma query com SQL
 * inválido só atrasa a falha final em ~600ms, nunca a mascara. Lança o
 * último erro se as 3 tentativas falharem.
 */
function comRetentativa(sql: string, wranglerArgs: string): string {
	let ultimoErro: unknown;
	for (let tentativa = 1; tentativa <= 3; tentativa++) {
		try {
			return comArquivoSql(sql, wranglerArgs);
		} catch (err) {
			ultimoErro = err;
			if (tentativa < 3) esperarMs(tentativa * 200);
		}
	}
	throw ultimoErro;
}

/** Executa SQL no D1 local; `false` quando o wrangler falha (com retentativa). */
export function execD1Local(sql: string): boolean {
	try {
		comRetentativa(sql, '');
		return true;
	} catch (err) {
		console.error(`[d1-local] execD1Local falhou após retentativas: ${linhaDeErro(err)}`);
		return false;
	}
}

/**
 * Consulta o D1 local e devolve as linhas (`--json`). `null` quando o wrangler
 * falha (com retentativa).
 */
export function queryD1Local<T = Record<string, unknown>>(sql: string): T[] | null {
	try {
		const out = comRetentativa(sql, '--json');
		const parsed = JSON.parse(out) as Array<{ results?: T[] }>;
		return parsed?.[0]?.results ?? [];
	} catch (err) {
		console.error(`[d1-local] queryD1Local falhou após retentativas: ${linhaDeErro(err)}`);
		return null;
	}
}

/**
 * Como `execD1Local`, mas reporta a linha de ERROR do stderr (global-setup).
 * Devolve `{ ok, erro }` sem engolir o diagnóstico.
 */
export function execD1LocalComErro(sql: string): { ok: boolean; erro?: string } {
	try {
		comRetentativa(sql, '');
		return { ok: true };
	} catch (err) {
		return { ok: false, erro: linhaDeErro(err) };
	}
}
