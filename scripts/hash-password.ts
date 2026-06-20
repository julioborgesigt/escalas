/**
 * Gera o hash PBKDF2 (formato `pbkdf2v2:...`) de uma senha, para uso nas envs de
 * bootstrap (`SUPER_ADMIN_SENHA` / `ADMIN_GERAL_SENHA`) sem armazenar a senha em
 * texto claro no dashboard/wrangler.
 *
 * Uso:
 *   HASH_PASSWORD=SENHA npx tsx scripts/hash-password.ts
 *
 * (env em vez de argv para a senha não vazar no histórico do shell / `ps`.)
 *
 * NOTA — emite v2 DE PROPÓSITO (sem pepper). Estas são as contas de
 * break-glass/root; o `verificarSenhaBootstrap` aceita v2 independentemente do
 * `PASSWORD_PEPPER`, então o acesso de emergência continua funcionando mesmo se o
 * pepper for perdido/rotacionado. Aplicar v3 aqui acoplaria o break-glass ao
 * segredo — exatamente o que NÃO se quer numa conta de emergência.
 */

// Mesma função do app ($lib/auth re-exporta deste módulo PURO) — sem cópia local
// que poderia divergir (item C6 da auditoria).
import { hashSenha } from '../src/lib/crypto/password-hash';

async function main() {
	const senha = process.env.HASH_PASSWORD;
	if (!senha) {
		console.error('Erro: defina a env HASH_PASSWORD.');
		console.error('Exemplo: HASH_PASSWORD=MinhaSenh@123 npx tsx scripts/hash-password.ts');
		process.exit(1);
	}
	// Sem pepper → emite v2 (ver NOTA acima sobre resiliência do break-glass).
	console.log(await hashSenha(senha));
}

main();
