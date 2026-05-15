/**
 * Anonimiza IPs históricos nas tabelas via anonimizarIp() (TypeScript).
 * Prefira a migration SQL 0017 para IPv4 simples.
 * Use este script para IPv6 ou se preferir maior controle por lote.
 *
 * Uso:
 *   npx tsx scripts/anonimizar-ips-historico.ts --yes             # local
 *   npx tsx scripts/anonimizar-ips-historico.ts --remote --yes    # produção
 */

import { execSync } from 'node:child_process';

const DB_NAME = 'escalas-db';

function anonimizarIp(ip: string | null | undefined): string | null {
	if (!ip) return null;
	if (ip.includes(':')) {
		const parts = ip.split(':');
		if (parts.length >= 3) return parts.slice(0, 3).join(':') + '::';
		return null;
	}
	const octets = ip.split('.');
	if (octets.length === 4) return `${octets[0]}.${octets[1]}.${octets[2]}.0`;
	return null;
}

const TABELAS: Array<{ tabela: string; campo: string }> = [
	{ tabela: 'login_attempts',               campo: 'ip' },
	{ tabela: 'audit_log',                    campo: 'ip' },
	{ tabela: 'aceites_termos',               campo: 'ip' },
	{ tabela: 'escala_documentos',            campo: 'ip_address' },
	{ tabela: 'gise_documentos',              campo: 'ip_address' },
	{ tabela: 'gise_presencas',               campo: 'ip_address' },
	{ tabela: 'gise_assinaturas_relatorios',  campo: 'ip_address' }
];

async function main() {
	const isRemote  = process.argv.includes('--remote');
	const confirmed = process.argv.includes('--yes');
	const flag      = isRemote ? '--remote' : '--local';

	if (!confirmed) {
		console.error('Confirmação obrigatória: adicione --yes para executar.');
		process.exit(1);
	}

	console.log(`Anonimizando IPs históricos em ${isRemote ? 'PRODUÇÃO' : 'LOCAL'}...`);

	for (const { tabela, campo } of TABELAS) {
		// Ler todos os registros com IP não-nulo
		const selectSql = `SELECT id, ${campo} FROM ${tabela} WHERE ${campo} IS NOT NULL AND ${campo} != ''`;
		let rows: Array<{ id: number; [k: string]: unknown }>;
		try {
			const out = execSync(
				`npx wrangler d1 execute ${DB_NAME} ${flag} --json --command="${selectSql}"`,
				{ encoding: 'utf8' }
			);
			const parsed = JSON.parse(out);
			rows = parsed?.[0]?.results ?? [];
		} catch {
			console.warn(`  [AVISO] Erro ao ler ${tabela}, pulando.`);
			continue;
		}

		let updated = 0;
		for (const row of rows) {
			const ipOriginal = row[campo] as string | null;
			const ipAnon = anonimizarIp(ipOriginal);
			if (!ipAnon || ipAnon === ipOriginal) continue;

			const updateSql = `UPDATE ${tabela} SET ${campo}='${ipAnon}' WHERE id=${row.id}`;
			execSync(`npx wrangler d1 execute ${DB_NAME} ${flag} --command="${updateSql}"`, {
				stdio: 'ignore'
			});
			updated++;
		}
		console.log(`  ${tabela}.${campo}: ${updated}/${rows.length} registros anonimizados.`);
	}

	console.log('Concluído.');
}

main().catch((err) => {
	console.error('Falha:', err);
	process.exit(1);
});
