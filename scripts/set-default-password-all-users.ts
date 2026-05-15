/**
 * Define uma senha para TODOS os usuários (policiais + administradores).
 *
 * Uso (local):
 *   npx tsx scripts/set-default-password-all-users.ts --password=SENHA --yes
 *
 * Uso (produção/remoto):
 *   npx tsx scripts/set-default-password-all-users.ts --password=SENHA --remote --yes
 *
 * ATENÇÃO: nunca use uma senha fixa/conhecida. Gere uma senha aleatória
 * e comunique-a aos usuários por canal seguro fora do terminal.
 */

import { execSync } from 'node:child_process';

const DB_NAME = 'escalas-db';
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

	const passwordArg = process.argv.find((a) => a.startsWith('--password='));
	if (!passwordArg) {
		console.error('Erro: forneça --password=SENHA como argumento.');
		console.error(
			'Exemplo: npx tsx scripts/set-default-password-all-users.ts --password=MinhaSenh@123 --yes'
		);
		console.error(
			'NUNCA use senhas fixas ou conhecidas. Gere uma senha aleatória e comunique por canal seguro.'
		);
		process.exit(1);
	}
	const DEFAULT_PASSWORD = passwordArg.slice('--password='.length);

	if (!DEFAULT_PASSWORD) {
		console.error('Erro: a senha informada está vazia.');
		process.exit(1);
	}

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
		`Aplicando senha em ${isRemote ? 'PRODUÇÃO (remoto)' : 'LOCAL'} para policiais e administradores...`
	);

	execSync(`npx wrangler d1 execute ${DB_NAME} ${flag} --command="${sql}"`, {
		stdio: 'inherit'
	});

	// Nunca imprimir a senha — apenas confirmar o encerramento.
	console.log('Concluído. Comunique a senha aos usuários por canal seguro e solicite troca imediata.');
}

main().catch((err) => {
	console.error('Falha ao aplicar senha padrão:', err);
	process.exit(1);
});
