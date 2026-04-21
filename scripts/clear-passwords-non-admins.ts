/**
 * Limpa a senha de TODOS os policiais, preservando os administradores.
 *
 * Uso (local):
 *   npx tsx scripts/clear-passwords-non-admins.ts --yes
 *
 * Uso (produção/remoto):
 *   npx tsx scripts/clear-passwords-non-admins.ts --remote --yes
 */

import { execSync } from 'node:child_process';

const DB_NAME = 'escalas-db';

async function main() {
	const isRemote = process.argv.includes('--remote');
	const confirmed = process.argv.includes('--yes');
	const flag = isRemote ? '--remote' : '--local';

	if (!confirmed) {
		console.error('Confirmação obrigatória: adicione --yes para executar.');
		process.exit(1);
	}

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

