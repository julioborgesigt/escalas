/**
 * Script para gerar um hash PBKDF2 de uma nova senha de admin.
 *
 * Uso:
 *   npx tsx scripts/reset-admin-password.ts "NovaSenha123"
 *
 * O script imprime o SQL para atualizar a senha no banco D1.
 * Execute o SQL via:
 *   npx wrangler d1 execute escalas_db --command="UPDATE administradores SET senha='<hash>' WHERE login='admin';"
 *
 * Ou para ambiente remoto (produção):
 *   npx wrangler d1 execute escalas_db --remote --command="UPDATE administradores SET senha='<hash>' WHERE login='admin';"
 */

const PBKDF2_PREFIX = 'pbkdf2v1:';
const PBKDF2_ITERATIONS = 100_000;

function toHex(bytes: Uint8Array): string {
	return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function hashSenha(senha: string): Promise<string> {
	const salt = crypto.getRandomValues(new Uint8Array(16));
	const saltHex = toHex(salt);

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
	const hashHex = toHex(new Uint8Array(hashBuffer));
	return `${PBKDF2_PREFIX}${saltHex}:${hashHex}`;
}

async function main() {
	const senha = process.argv[2];
	if (!senha) {
		console.error('Uso: npx tsx scripts/reset-admin-password.ts "SuaNovaSenha123"');
		console.error('');
		console.error('Requisitos da senha:');
		console.error('  - Mínimo 8 caracteres');
		console.error('  - Pelo menos 1 letra maiúscula');
		console.error('  - Pelo menos 1 letra minúscula');
		console.error('  - Pelo menos 1 número');
		process.exit(1);
	}

	// Validações básicas
	if (senha.length < 8) { console.error('ERRO: Senha deve ter no mínimo 8 caracteres'); process.exit(1); }
	if (!/[A-Z]/.test(senha)) { console.error('ERRO: Senha deve conter letra maiúscula'); process.exit(1); }
	if (!/[a-z]/.test(senha)) { console.error('ERRO: Senha deve conter letra minúscula'); process.exit(1); }
	if (!/[0-9]/.test(senha)) { console.error('ERRO: Senha deve conter número'); process.exit(1); }

	const hash = await hashSenha(senha);

	console.log('');
	console.log('Hash PBKDF2 gerado com sucesso!');
	console.log('');
	console.log('=== SQL para atualizar o admin ===');
	console.log('');
	console.log(`-- Atualizar senha do admin (local):`);
	console.log(`npx wrangler d1 execute escalas_db --command="UPDATE administradores SET senha='${hash}', primeiro_acesso=0 WHERE login='admin';"`);
	console.log('');
	console.log(`-- Atualizar senha do admin (produção/remoto):`);
	console.log(`npx wrangler d1 execute escalas_db --remote --command="UPDATE administradores SET senha='${hash}', primeiro_acesso=0 WHERE login='admin';"`);
	console.log('');
	console.log('=== Para resetar um policial específico ===');
	console.log('');
	console.log(`npx wrangler d1 execute escalas_db --remote --command="UPDATE policiais SET senha='${hash}', primeiro_acesso=1 WHERE matricula='MATRICULA_AQUI';"`);
	console.log('');
}

main().catch(console.error);
