/**
 * Define uma senha padrão para TODOS os usuários (policiais + administradores).
 *
 * Uso (local):
 *   npx tsx scripts/set-default-password-all-users.ts --yes
 *
 * Uso (produção/remoto):
 *   npx tsx scripts/set-default-password-all-users.ts --remote --yes
 */

import { execSync } from 'node:child_process';

const DB_NAME = 'escalas-db';
const DEFAULT_PASSWORD = 'J1a2b3cd4j';
const PBKDF2_PREFIX = 'pbkdf2v1:';
const PBKDF2_ITERATIONS = 100_000;

function toHex(bytes: Uint8Array): string {
	return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function hashSenha(senha: string): Promise<string> {
	const salt = crypto.getRandomValues(new Uint8Array(16));
	const keyMaterial = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(senha),
		'PBKDF2',
		false,
		['deriveBits']
	);
	const hashBuffer = await crypto.subtle.deriveBits(
		{ name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
		keyMaterial,
		256
	);
	return `${PBKDF2_PREFIX}${toHex(salt)}:${toHex(new Uint8Array(hashBuffer))}`;
}

async function main() {
	const isRemote = process.argv.includes('--remote');
	const confirmed = process.argv.includes('--yes');
	const flag = isRemote ? '--remote' : '--local';

	if (!confirmed) {
		console.error('Confirmação obrigatória: adicione --yes para executar.');
		process.exit(1);
	}

	const hash = await hashSenha(DEFAULT_PASSWORD);
	const sql = [
		`UPDATE policiais SET senha='${hash}', primeiro_acesso=0, updated_at=datetime('now', '-3 hours');`,
		`UPDATE administradores SET senha='${hash}', primeiro_acesso=0;`
	].join(' ');

	console.log(
		`Aplicando senha padrão em ${isRemote ? 'PRODUÇÃO (remoto)' : 'LOCAL'} para policiais e administradores...`
	);

	execSync(`npx wrangler d1 execute ${DB_NAME} ${flag} --command="${sql}"`, {
		stdio: 'inherit'
	});

	console.log('Concluído.');
	console.log(`Senha padrão aplicada: ${DEFAULT_PASSWORD}`);
}

main().catch((err) => {
	console.error('Falha ao aplicar senha padrão:', err);
	process.exit(1);
});

