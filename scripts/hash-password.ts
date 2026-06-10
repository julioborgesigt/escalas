/**
 * Gera o hash PBKDF2 (formato `pbkdf2v2:...` de $lib/auth) de uma senha, para
 * uso nas envs de bootstrap (`SUPER_ADMIN_SENHA` / `ADMIN_GERAL_SENHA`) sem
 * armazenar a senha em texto claro no dashboard/wrangler.
 *
 * Uso:
 *   HASH_PASSWORD=SENHA npx tsx scripts/hash-password.ts
 *
 * (env em vez de argv para a senha não vazar no histórico do shell / `ps`.)
 */

const PBKDF2_PREFIX = 'pbkdf2v2:';
const PBKDF2_ITERATIONS = 100_000; // manter alinhado com src/lib/auth.ts

function toHex(bytes: Uint8Array): string {
	return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function main() {
	const senha = process.env.HASH_PASSWORD;
	if (!senha) {
		console.error('Erro: defina a env HASH_PASSWORD.');
		console.error('Exemplo: HASH_PASSWORD=MinhaSenh@123 npx tsx scripts/hash-password.ts');
		process.exit(1);
	}
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
	console.log(`${PBKDF2_PREFIX}${PBKDF2_ITERATIONS}:${toHex(salt)}:${toHex(new Uint8Array(hashBuffer))}`);
}

main();
