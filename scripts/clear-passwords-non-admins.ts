/**
 * Limpa a senha de TODOS os policiais, preservando os administradores.
 *
 * Uso (local):
 *   npm run users:clear-passwords-non-admins -- --yes
 *
 * Uso (produção/remoto):
 *   CONFIRMO_PRODUCAO=escalas-db npm run users:clear-passwords-non-admins:prod -- --yes
 *
 * O `--yes` NÃO vem embutido no `npm run` de propósito — ver
 * `scripts/confirmar-producao.ts`.
 */

import { execSync } from 'node:child_process';
import { exigirConfirmacao, DB_NAME } from './confirmar-producao';

async function main() {
	const isRemote = process.argv.includes('--remote');
	const flag = isRemote ? '--remote' : '--local';

	exigirConfirmacao({
		remoto: isRemote,
		confirmado: process.argv.includes('--yes'),
		efeito: 'zerar a senha de TODOS os policiais (administradores preservados)',
		exemplo: isRemote
			? 'CONFIRMO_PRODUCAO=escalas-db npm run users:clear-passwords-non-admins:prod -- --yes'
			: 'npm run users:clear-passwords-non-admins -- --yes'
	});

	// Preserva administradores: atualiza apenas a tabela policiais.
	// Mantemos primeiro_acesso=1 para forçar novo fluxo de definição de senha.
	const sql =
		"UPDATE policiais SET senha='', primeiro_acesso=1, updated_at=datetime('now', '-3 hours');";

	console.log(
		`Limpando senha de policiais em ${isRemote ? 'PRODUÇÃO (remoto)' : 'LOCAL'} (administradores preservados)...`
	);

	execSync(`npx wrangler d1 execute ${DB_NAME} ${flag} --command="${sql}"`, {
		stdio: 'inherit'
	});

	console.log('Concluído.');
}

main().catch((err) => {
	console.error('Falha ao limpar senhas:', err);
	process.exit(1);
});
