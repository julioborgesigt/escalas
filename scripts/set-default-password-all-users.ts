/**
 * Define uma senha para TODOS os usuários (policiais + administradores).
 *
 * Uso (local):
 *   SET_PASSWORD=SENHA npx tsx scripts/set-default-password-all-users.ts --yes
 *
 * Uso (produção/remoto):
 *   SET_PASSWORD=SENHA npx tsx scripts/set-default-password-all-users.ts --remote --yes
 *
 * A senha vem da env `SET_PASSWORD` (ou de `--password=SENHA`, DEPRECADO:
 * argv vaza no histórico do shell e em `ps`). Todos os usuários ficam com
 * `primeiro_acesso=1` — a senha compartilhada é provisória por definição e a
 * troca é forçada no primeiro login.
 *
 * ATENÇÃO: nunca use uma senha fixa/conhecida. Gere uma senha aleatória
 * e comunique-a aos usuários por canal seguro fora do terminal.
 */

import { execSync } from 'node:child_process';
// Mesma função do app ($lib/auth re-exporta deste módulo PURO) — sem cópia local
// que poderia divergir (item C6 da auditoria).
import { hashSenha } from '../src/lib/crypto/password-hash';

const DB_NAME = 'escalas-db';

async function main() {
	const isRemote = process.argv.includes('--remote');
	const confirmed = process.argv.includes('--yes');
	const flag = isRemote ? '--remote' : '--local';

	const passwordArg = process.argv.find((a) => a.startsWith('--password='));
	if (passwordArg) {
		console.warn(
			'AVISO: --password em argv fica no histórico do shell e visível em `ps`. ' +
				'Prefira a env SET_PASSWORD.'
		);
	}
	const DEFAULT_PASSWORD = process.env.SET_PASSWORD ?? passwordArg?.slice('--password='.length);

	if (!DEFAULT_PASSWORD) {
		console.error('Erro: forneça a senha via env SET_PASSWORD (preferido) ou --password=SENHA.');
		console.error(
			'Exemplo: SET_PASSWORD=MinhaSenh@123 npx tsx scripts/set-default-password-all-users.ts --yes'
		);
		console.error(
			'NUNCA use senhas fixas ou conhecidas. Gere uma senha aleatória e comunique por canal seguro.'
		);
		process.exit(1);
	}

	if (!confirmed) {
		console.error('Confirmação obrigatória: adicione --yes para executar.');
		process.exit(1);
	}

	// Pepper-aware: com PASSWORD_PEPPER no ambiente, as senhas já nascem v3
	// (mesma proteção do app). Sem ele, emite v2 e o login migra para v3 depois.
	// Rode com o MESMO PASSWORD_PEPPER de produção para o app conseguir verificar.
	const pepper = process.env.PASSWORD_PEPPER?.trim() || undefined;
	const hash = await hashSenha(DEFAULT_PASSWORD, pepper);
	// primeiro_acesso=1: senha compartilhada é provisória — força a troca (e a
	// verificação de e-mail pessoal) no primeiro login de cada usuário.
	const sql = [
		`UPDATE policiais SET senha='${hash}', primeiro_acesso=1, updated_at=datetime('now', '-3 hours');`,
		`UPDATE administradores SET senha='${hash}', primeiro_acesso=1;`
	].join(' ');

	console.log(
		`Aplicando senha em ${isRemote ? 'PRODUÇÃO (remoto)' : 'LOCAL'} para policiais e administradores...`
	);

	execSync(`npx wrangler d1 execute ${DB_NAME} ${flag} --command="${sql}"`, {
		stdio: 'inherit'
	});

	// Nunca imprimir a senha — apenas confirmar o encerramento.
	console.log(
		'Concluído. Comunique a senha aos usuários por canal seguro; a troca será exigida no primeiro login.'
	);
}

main().catch((err) => {
	console.error('Falha ao aplicar senha padrão:', err);
	process.exit(1);
});
