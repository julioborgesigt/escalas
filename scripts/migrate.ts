/**
 * Script de migração automática do D1.
 *
 * Lê todos os arquivos SQL em migrations/ em ordem e executa
 * sequencialmente via wrangler CLI.
 *
 * Uso:
 *   npm run db:migrate               → executa localmente (--local)
 *   npm run db:migrate:staging       → executa no D1 de STAGING (--remote --staging)
 *   npm run db:migrate:prod -- --yes → executa em PRODUÇÃO (--remote)
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
const DB_NAME = STAGING ? 'escalas-db-staging' : 'escalas-db';
const FLAG = REMOTE ? '--remote' : '--local';
const ALVO = !REMOTE ? 'LOCAL' : STAGING ? 'STAGING (remoto)' : 'PRODUÇÃO (remoto)';

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

console.log(`\n🚀 Executando migrations no D1 (${ALVO}) — banco ${DB_NAME}...\n`);

const files = readdirSync(MIGRATIONS_DIR)
	.filter(f => f.endsWith('.sql'))
	.sort();

if (files.length === 0) {
	console.log('⚠️  Nenhuma migration encontrada em migrations/');
	process.exit(0);
}

console.log(`📋 ${files.length} migrations encontradas:\n`);
files.forEach(f => console.log(`   ${f}`));
console.log('');

let success = 0;
let failed = 0;

for (const file of files) {
	const filePath = join(MIGRATIONS_DIR, file);
	try {
		execSync(
			`npx wrangler d1 execute ${DB_NAME} ${FLAG} --file="${filePath}"`,
			{ stdio: 'pipe' }
		);
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

		if (isAlreadyApplied) {
			console.log(`  ⏭️  ${file} (já aplicada)`);
			success++;
		} else if (isNoOp) {
			console.log(`  ⏭️  ${file} (documental, sem DDL — no-op)`);
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
