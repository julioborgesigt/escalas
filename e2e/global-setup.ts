import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { VERSAO as TERMO_VERSAO, calcularHashTermo } from '../src/lib/server/termo/termo-vigente';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Fixture compartilhada entre o global-setup e as specs cross-lotação. IDs
 * são bem fora da faixa de produção (99xxx) pra não colidir com sync da
 * planilha que costuma usar IDs pequenos. `password` é fixo e em texto
 * claro PROPOSITALMENTE — é uma conta sintética que existe só no D1 local,
 * nunca em produção.
 */
export const FIXTURE = {
	password: 'fixture-cross-lotacao-2026!',
	unidadeA: { id: 99001, nome: 'DELEGACIA E2E FIXTURE A' },
	unidadeB: { id: 99002, nome: 'DELEGACIA E2E FIXTURE B' },
	policialA: { id: 99001, matricula: 'EE990001' },
	policialB: { id: 99002, matricula: 'EE990002' },
	escalaA: { id: 99001 }
} as const;

function execSqlSafe(sql: string): boolean {
	try {
		// `--command` aceita múltiplos statements separados por `;`. Aspas duplas
		// dentro do SQL precisam ser escapadas no shell.
		execSync(
			`npx wrangler d1 execute escalas-db --local --command "${sql.replace(/"/g, '\\"')}"`,
			{ cwd: ROOT, stdio: 'pipe' }
		);
		return true;
	} catch {
		return false;
	}
}

/**
 * Replica `hashSenha` de src/lib/auth.ts sem importar o módulo inteiro
 * (que carrega DB, drizzle, etc.). Mantém em sincronia: pbkdf2v1 + 100k
 * iterações + SHA-256 + salt random 16 bytes. Se PBKDF2_ITERATIONS mudar
 * em produção, este script PRECISA ser atualizado também.
 */
async function hashSenhaParaFixture(senha: string): Promise<string> {
	const salt = crypto.getRandomValues(new Uint8Array(16));
	const saltHex = Array.from(salt)
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
	const key = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(senha),
		'PBKDF2',
		false,
		['deriveBits']
	);
	const bits = await crypto.subtle.deriveBits(
		{ name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
		key,
		256
	);
	const hashHex = Array.from(new Uint8Array(bits))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
	return `pbkdf2v1:${saltHex}:${hashHex}`;
}

export default async function globalSetup() {
	// Limpa tentativas de login no D1 local para e2e não herdarem rate limit
	// de execuções anteriores (preview reutiliza o mesmo arquivo de estado
	// com `reuseExistingServer`).
	execSqlSafe('DELETE FROM login_attempts;');

	// ── Fixture cross-lotação ────────────────────────────────────────────
	// Cria 2 unidades + 2 policiais (cada um numa unidade) + 1 escala em
	// DEL-A com documento assinado fake. Os specs usam isso para verificar
	// que o policial de DEL-B NÃO consegue baixar o documento de DEL-A
	// (regressão P0.1 da auditoria de segurança).
	//
	// email=NULL pula 2FA (auth-flow:354 exige email para mandar código).
	// primeiro_acesso=0 pula redirect para /alterar-senha.
	const senhaHash = await hashSenhaParaFixture(FIXTURE.password);
	const fixtureSeed = `
		INSERT OR REPLACE INTO unidades (id, nome, tipo) VALUES
			(${FIXTURE.unidadeA.id}, '${FIXTURE.unidadeA.nome}', 'delegacia'),
			(${FIXTURE.unidadeB.id}, '${FIXTURE.unidadeB.nome}', 'delegacia');
		INSERT OR REPLACE INTO policiais
			(id, matricula, nome, cargo, lotacao, senha, primeiro_acesso, email, ativo)
		VALUES
			(${FIXTURE.policialA.id}, '${FIXTURE.policialA.matricula}', 'Policial Fixture A', 'OIP', '${FIXTURE.unidadeA.nome}', '${senhaHash}', 0, NULL, 1),
			(${FIXTURE.policialB.id}, '${FIXTURE.policialB.matricula}', 'Policial Fixture B', 'OIP', '${FIXTURE.unidadeB.nome}', '${senhaHash}', 0, NULL, 1);
		INSERT OR REPLACE INTO escalas (id, titulo, cidade, tipo, lotacao, data_inicio, data_fim)
		VALUES
			(${FIXTURE.escalaA.id}, 'Escala E2E Fixture A', 'Fortaleza', 'plantao', '${FIXTURE.unidadeA.nome}', '2026-01-01', '2026-01-01');
		DELETE FROM escala_documentos WHERE escala_id = ${FIXTURE.escalaA.id};
		INSERT INTO escala_documentos (escala_id, r2_key, assinante_nome, verificacao_hash)
		VALUES (${FIXTURE.escalaA.id}, 'test/fixture-${FIXTURE.escalaA.id}.pdf', 'Policial Fixture A', 'fixture-hash-${FIXTURE.escalaA.id}');
	`;

	const fixtureOk = execSqlSafe(fixtureSeed);

	// Aceite do Termo de Uso vigente para os dois fixture-users. Sem isto, o
	// `handleAuth` em hooks.server.ts redireciona/bloqueia tudo com 403
	// ("Aceite o Termo de Uso vigente antes de continuar") antes dos
	// handlers de API rodarem.
	const termoHash = await calcularHashTermo();
	const aceitesSeed = `
		DELETE FROM aceites_termos
		WHERE usuario_tipo = 'policial'
			AND usuario_id IN (${FIXTURE.policialA.id}, ${FIXTURE.policialB.id});
		INSERT INTO aceites_termos
			(usuario_tipo, usuario_id, versao_termo, hash_termo, aceitou_lgpd, aceitou_uso_email, aceitou_uso_localizacao)
		VALUES
			('policial', ${FIXTURE.policialA.id}, '${TERMO_VERSAO}', '${termoHash}', 1, 1, 1),
			('policial', ${FIXTURE.policialB.id}, '${TERMO_VERSAO}', '${termoHash}', 1, 1, 1);
	`;
	execSqlSafe(aceitesSeed);
	if (!fixtureOk) {
		console.warn(
			'[global-setup] Fixture cross-lotação não foi seedada (D1 local indisponível). ' +
				'Specs que dependem dela vão pular via test.skip().'
		);
	}
}
