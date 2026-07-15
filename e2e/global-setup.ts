import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { VERSAO as TERMO_VERSAO, calcularHashTermo } from '../src/lib/server/termo/termo-vigente';
// Mesma função de hash do app (módulo PURO) — sem cópia local que divergiria
// do formato real (item C6 da auditoria). Sem pepper → emite v2.
import { hashSenha } from '../src/lib/crypto/password-hash';

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
	escalaA: { id: 99001 },
	// ── GISE ativa (telas /gise/[id] e /res-gise) ─────────────────────────
	seccional: { id: 99010, nome: 'SECCIONAL E2E FIXTURE' },
	supervisor: { id: 99003, matricula: 'EE990003', nome: 'Supervisor Fixture DPC' },
	membroGise: { id: 99004, matricula: 'EE990004', nome: 'Membro Fixture GISE' },
	gise: { id: 99001, dataInicio: '2026-06-01' },
	giseSeccional: { id: 99001 },
	giseEquipe: { id: 99001 }
} as const;

function execSqlSafe(sql: string): boolean {
	try {
		// `--command` aceita múltiplos statements separados por `;`. Aspas duplas
		// dentro do SQL precisam ser escapadas no shell.
		execSync(`npx wrangler d1 execute escalas-db --local --command "${sql.replace(/"/g, '\\"')}"`, {
			cwd: ROOT,
			stdio: 'pipe'
		});
		return true;
	} catch {
		return false;
	}
}

/**
 * Aplica as migrations pendentes no D1 LOCAL antes de semear. Sem isto, num
 * ambiente limpo (CI, container novo) o banco não tem NENHUMA tabela: os
 * seeds abaixo falham silenciosamente (execSqlSafe → false), specs
 * autenticados pulam e o login estoura 500 ("no such table: login_attempts")
 * em vez dos 401/403 que o auth.spec espera. Em máquina de dev já migrada é
 * um no-op rápido (controle em `_migrations_aplicadas`).
 */
function aplicarMigracoesLocais(): boolean {
	try {
		execSync('npx tsx scripts/migrate.ts', { cwd: ROOT, stdio: 'pipe' });
		return true;
	} catch {
		return false;
	}
}

export default async function globalSetup() {
	if (!aplicarMigracoesLocais()) {
		console.warn(
			'[global-setup] Falha ao aplicar migrations no D1 local — specs que dependem do banco vão falhar/pular.'
		);
	}

	// Limpa tentativas de login no D1 local para e2e não herdarem rate limit
	// de execuções anteriores (preview reutiliza o mesmo arquivo de estado
	// com `reuseExistingServer`). Sessões semeadas (e2e/session.ts) das contas
	// fixture também são purgadas — após o primeiro uso o token é re-gravado
	// hasheado, então a limpeza é por usuario_id, não por prefixo.
	execSqlSafe(
		'DELETE FROM login_attempts; DELETE FROM sessoes WHERE usuario_id BETWEEN 99000 AND 99999;'
	);

	// ── Fixture cross-lotação ────────────────────────────────────────────
	// Cria 2 unidades + 2 policiais (cada um numa unidade) + 1 escala em
	// DEL-A com documento assinado fake. Os specs usam isso para verificar
	// que o policial de DEL-B NÃO consegue baixar o documento de DEL-A
	// (regressão P0.1 da auditoria de segurança).
	//
	// email=NULL: o 2FA fail-closed BLOQUEIA o login por senha dessas contas
	// (403) — os specs autenticam via sessão semeada (e2e/session.ts).
	// primeiro_acesso=0 pula redirect para /alterar-senha.
	const senhaHash = await hashSenha(FIXTURE.password);
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

	// ── Fixture GISE ativa ───────────────────────────────────────────────
	// Uma GISE 'em_andamento' (= "ativa": status != finalizada) com seccional
	// preenchida, 1 equipe operacional e 1 membro; supervisor DPC designado.
	// Destrava as telas /gise/[id] (supervisor/admin) e /res-gise (membro).
	const giseSeed = `
		INSERT OR REPLACE INTO unidades (id, nome, tipo) VALUES
			(${FIXTURE.seccional.id}, '${FIXTURE.seccional.nome}', 'seccional');
		INSERT OR REPLACE INTO policiais
			(id, matricula, nome, cargo, lotacao, senha, primeiro_acesso, email, ativo)
		VALUES
			(${FIXTURE.supervisor.id}, '${FIXTURE.supervisor.matricula}', '${FIXTURE.supervisor.nome}', 'DPC', '${FIXTURE.seccional.nome}', '${senhaHash}', 0, NULL, 1),
			(${FIXTURE.membroGise.id}, '${FIXTURE.membroGise.matricula}', '${FIXTURE.membroGise.nome}', 'OIP', '${FIXTURE.unidadeA.nome}', '${senhaHash}', 0, NULL, 1);
		INSERT OR REPLACE INTO gise_escalas (id, data_inicio, status, hora_entrada, hora_saida, supervisor_id)
		VALUES (${FIXTURE.gise.id}, '${FIXTURE.gise.dataInicio}', 'em_andamento', '08:00', '16:00', ${FIXTURE.supervisor.id});
		INSERT OR REPLACE INTO gise_seccionais (id, gise_id, seccional_id, status, hora_entrada, hora_saida)
		VALUES (${FIXTURE.giseSeccional.id}, ${FIXTURE.gise.id}, ${FIXTURE.seccional.id}, 'preenchida', '08:00', '16:00');
		INSERT OR REPLACE INTO gise_equipes (id, gise_seccional_id, tipo, slots_dpc, slots_oip)
		VALUES (${FIXTURE.giseEquipe.id}, ${FIXTURE.giseSeccional.id}, 'operacional', 1, 4);
		DELETE FROM gise_membros WHERE equipe_id = ${FIXTURE.giseEquipe.id};
		INSERT INTO gise_membros (equipe_id, policial_id)
		VALUES (${FIXTURE.giseEquipe.id}, ${FIXTURE.membroGise.id});
		DELETE FROM gise_presencas WHERE gise_id = ${FIXTURE.gise.id};
	`;
	const giseOk = execSqlSafe(giseSeed);
	if (!giseOk) {
		console.warn('[global-setup] Fixture GISE não foi seedada — specs de GISE vão pular.');
	}

	// Aceite do Termo de Uso vigente para os dois fixture-users. Sem isto, o
	// `handleAuth` em hooks.server.ts redireciona/bloqueia tudo com 403
	// ("Aceite o Termo de Uso vigente antes de continuar") antes dos
	// handlers de API rodarem.
	const termoHash = await calcularHashTermo();
	const idsFixture = [
		FIXTURE.policialA.id,
		FIXTURE.policialB.id,
		FIXTURE.supervisor.id,
		FIXTURE.membroGise.id
	];
	const aceitesSeed = `
		DELETE FROM aceites_termos
		WHERE usuario_tipo = 'policial'
			AND usuario_id IN (${idsFixture.join(', ')});
		INSERT INTO aceites_termos
			(usuario_tipo, usuario_id, versao_termo, hash_termo, aceitou_lgpd, aceitou_uso_email, aceitou_uso_localizacao)
		VALUES
			${idsFixture.map((id) => `('policial', ${id}, '${TERMO_VERSAO}', '${termoHash}', 1, 1, 1)`).join(',\n\t\t\t')};
	`;
	execSqlSafe(aceitesSeed);
	if (!fixtureOk) {
		console.warn(
			'[global-setup] Fixture cross-lotação não foi seedada (D1 local indisponível). ' +
				'Specs que dependem dela vão pular via test.skip().'
		);
	}
}
