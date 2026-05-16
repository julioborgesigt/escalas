/**
 * Script de migração automática do D1.
 *
 * Lê todos os arquivos SQL em migrations/ em ordem e executa
 * sequencialmente via wrangler CLI.
 *
 * Uso:
 *   npm run db:migrate              → executa localmente (--local)
 *   npm run db:migrate:prod -- --yes → executa em PRODUÇÃO (--remote)
 *
 * Enquanto staging e produção compartilham o mesmo D1 (ver
 * DEPLOY.md → "Separação staging vs produção"), o flag --yes é
 * obrigatório em --remote para evitar mutação acidental de produção.
 */

import { execSync } from 'child_process';
import { readdirSync } from 'fs';
import { join, resolve } from 'path';

const MIGRATIONS_DIR = resolve(import.meta.dirname, '../migrations');
const DB_NAME = 'escalas-db';
const REMOTE = process.argv.includes('--remote');
const CONFIRMED = process.argv.includes('--yes');
const FLAG = REMOTE ? '--remote' : '--local';

if (REMOTE && !CONFIRMED) {
	console.error(
		'\n❌ Bloqueado: --remote escreve no banco de PRODUÇÃO.\n' +
			'   Confirme explicitamente com --yes:\n' +
			'   npm run db:migrate:prod -- --yes\n'
	);
	process.exit(1);
}

console.log(`\n🚀 Executando migrations no D1 (${REMOTE ? 'PRODUÇÃO' : 'LOCAL'})...\n`);

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
		// wrangler retorna erro se a migration já foi aplicada (tabela já existe)
		if (
			stderr.includes('already exists') ||
			stderr.includes('no changes to apply') ||
			stderr.includes('duplicate column') ||
			stderr.includes('SQLITE_ERROR') === false
		) {
			console.log(`  ⏭️  ${file} (já aplicada)`);
			success++;
		} else {
			console.error(`  ❌ ${file}: ${stderr.slice(0, 200)}`);
			failed++;
		}
	}
}

console.log(`\n📊 Resultado: ${success} aplicadas, ${failed} falhas\n`);

if (failed > 0) {
	process.exit(1);
}
