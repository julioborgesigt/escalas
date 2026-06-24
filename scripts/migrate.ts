/**
 * Script de migração automática do D1.
 *
 * Lê todos os arquivos SQL em migrations/ em ordem e executa as que ainda NÃO
 * foram aplicadas, registrando cada uma numa tabela de controle
 * (`_migrations_aplicadas`). Isso evita re-executar migrations que não são
 * idempotentes (ex.: rebuilds de tabela que recriam um CHECK mais estreito e
 * regrediriam o schema).
 *
 * Uso:
 *   npm run db:migrate                      → executa localmente (--local)
 *   npm run db:migrate:staging              → STAGING (--remote --staging)
 *   npm run db:migrate:prod -- --yes        → PRODUÇÃO (--remote)
 *   npm run db:migrate:prod -- --yes --baseline
 *       → ADOÇÃO ÚNICA: marca TODAS as migrations atuais como aplicadas SEM
 *         executá-las. Use uma vez num banco que já está migrado (como a
 *         produção atual) para "adotar" o controle sem re-rodar nada. Depois
 *         disso, só migrations novas serão executadas.
 *
 * Alvos: `--staging` aponta para `escalas-db-staging` (banco dedicado, ver
 * wrangler.toml [env.preview]); sem ele, `--remote` aponta para PRODUÇÃO
 * (`escalas-db`). Só produção remota exige o flag `--yes` (defesa contra
 * mutação acidental); staging é seguro por ter banco próprio.
 */

import { execSync } from 'child_process';
import { readdirSync } from 'fs';
import { join, resolve } from 'path';

const MIGRATIONS_DIR = resolve(import.meta.dirname, '../migrations');
const REMOTE = process.argv.includes('--remote');
const STAGING = process.argv.includes('--staging');
const CONFIRMED = process.argv.includes('--yes');
const BASELINE = process.argv.includes('--baseline');
const DB_NAME = STAGING ? 'escalas-db-staging' : 'escalas-db';
const FLAG = REMOTE ? '--remote' : '--local';
const ALVO = !REMOTE ? 'LOCAL' : STAGING ? 'STAGING (remoto)' : 'PRODUÇÃO (remoto)';

const CONTROL_TABLE = '_migrations_aplicadas';

// Só produção remota (--remote sem --staging) exige confirmação explícita.
// Staging tem banco dedicado (seguro); local é descartável.
if (REMOTE && !STAGING && !CONFIRMED) {
	console.error(
		'\n❌ Bloqueado: --remote (sem --staging) escreve no banco de PRODUÇÃO.\n' +
			'   Confirme explicitamente com --yes:\n' +
			'   npm run db:migrate:prod -- --yes\n' +
			'   (Para staging, use: npm run db:migrate:staging)\n'
	);
	process.exit(1);
}

/** Executa um comando SQL avulso (não-arquivo) e devolve o stdout cru. */
function d1Command(sql: string, json = false): string {
	const escaped = sql.replace(/"/g, '\\"');
	return execSync(
		`npx wrangler d1 execute ${DB_NAME} ${FLAG} ${json ? '--json ' : ''}--command "${escaped}"`,
		{ stdio: ['ignore', 'pipe', 'pipe'] }
	).toString();
}

/** Garante a tabela de controle (idempotente). */
function ensureControlTable(): void {
	d1Command(
		`CREATE TABLE IF NOT EXISTS ${CONTROL_TABLE} (` +
			`nome TEXT PRIMARY KEY, ` +
			`aplicada_em TEXT NOT NULL DEFAULT (datetime('now')))`
	);
}

/** Conjunto de migrations já registradas como aplicadas. */
function getApplied(): Set<string> {
	try {
		const out = d1Command(`SELECT nome FROM ${CONTROL_TABLE}`, true);
		const start = out.indexOf('[');
		if (start < 0) return new Set();
		const parsed = JSON.parse(out.slice(start)) as Array<{
			results?: Array<{ nome?: string }>;
		}>;
		const rows = parsed[0]?.results ?? [];
		return new Set(rows.map((r) => r.nome).filter((n): n is string => typeof n === 'string'));
	} catch {
		// Sem tabela ainda ou falha de parse: trata como "nada aplicado".
		return new Set();
	}
}

/** Registra (idempotente) uma migration como aplicada. */
function recordApplied(file: string): void {
	const safe = file.replace(/'/g, "''");
	d1Command(`INSERT OR IGNORE INTO ${CONTROL_TABLE} (nome) VALUES ('${safe}')`);
}

const files = readdirSync(MIGRATIONS_DIR)
	.filter((f) => f.endsWith('.sql'))
	.sort();

if (files.length === 0) {
	console.log('⚠️  Nenhuma migration encontrada em migrations/');
	process.exit(0);
}

// --- Modo BASELINE: adota o controle num banco já migrado, sem executar nada ---
if (BASELINE) {
	console.log(
		`\n🏷️  BASELINE no D1 (${ALVO}) — banco ${DB_NAME}\n` +
			`   Marcando ${files.length} migrations como aplicadas SEM executá-las.\n`
	);
	ensureControlTable();
	const jaAplicadas = getApplied();
	let novas = 0;
	for (const file of files) {
		if (jaAplicadas.has(file)) {
			console.log(`  ⏭️  ${file} (já registrada)`);
		} else {
			recordApplied(file);
			console.log(`  🏷️  ${file} (registrada como aplicada)`);
			novas++;
		}
	}
	console.log(`\n📊 Baseline concluído: ${novas} registradas, ${files.length - novas} já existiam.\n`);
	process.exit(0);
}

console.log(`\n🚀 Executando migrations no D1 (${ALVO}) — banco ${DB_NAME}...\n`);

ensureControlTable();
const aplicadas = getApplied();

const pendentes = files.filter((f) => !aplicadas.has(f));
console.log(
	`📋 ${files.length} migrations no diretório — ${aplicadas.size} já aplicadas, ` +
		`${pendentes.length} pendentes.\n`
);
if (pendentes.length === 0) {
	console.log('✅ Nada a fazer: banco já está em dia.\n');
	process.exit(0);
}
pendentes.forEach((f) => console.log(`   ${f}`));
console.log('');

let success = 0;
let failed = 0;

for (const file of pendentes) {
	const filePath = join(MIGRATIONS_DIR, file);
	try {
		execSync(`npx wrangler d1 execute ${DB_NAME} ${FLAG} --file="${filePath}"`, { stdio: 'pipe' });
		recordApplied(file);
		console.log(`  ✅ ${file}`);
		success++;
	} catch (err) {
		const stderr = (err as { stderr?: Buffer }).stderr?.toString() || '';
		const isAlreadyApplied =
			stderr.includes('already exists') ||
			stderr.includes('no changes to apply') ||
			stderr.includes('duplicate column');
		// Migrações puramente documentais (só comentários, sem DDL — ex.: 0004,
		// que apenas registra novos valores de enum numa coluna TEXT) fazem o
		// `d1 execute` reclamar "did not contain a statement". É no-op, não erro;
		// o caminho nativo (`wrangler d1 migrations apply`, no CI) também as ignora.
		const isNoOp = stderr.includes('did not contain a statement');

		if (isAlreadyApplied || isNoOp) {
			// Estado já presente no banco: registra para não tentar de novo.
			recordApplied(file);
			console.log(`  ⏭️  ${file} (${isNoOp ? 'documental, sem DDL — no-op' : 'já aplicada'})`);
			success++;
		} else {
			// Mostra o erro REAL e completo. O `wrangler` polui o stderr com banner,
			// barra de progresso e o aviso "database will be unavailable"; filtramos
			// essas linhas para não truncar/escondê-la a mensagem de fato útil.
			const motivo =
				stderr
					.split('\n')
					.map((l) => l.replace(/\s+$/, ''))
					.filter(
						(l) =>
							l.trim() &&
							!l.includes('may take some time') &&
							!l.includes('unavailable to serve queries') &&
							!/^[─━\s]*$/.test(l)
					)
					.join('\n')
					.trim() || stderr.trim();
			console.error(`  ❌ ${file}:\n${motivo}\n`);
			failed++;
		}
	}
}

console.log(`\n📊 Resultado: ${success} aplicadas, ${failed} falhas\n`);

if (failed > 0) {
	process.exit(1);
}
