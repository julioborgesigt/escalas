/**
 * Expurga por prazo de retenção (LGPD art. 15/16) e o failsafe que avisa quando
 * ela para de rodar.
 *
 * A linha que divide o que é apagado do que não é: TEMPORÁRIO sai, PROBATÓRIO
 * fica. Sessões, tokens e tentativas têm TTL curto; `audit_log` tem TTL longo e
 * configurável (5 anos por padrão); documento, assinatura e termo de presença
 * NÃO são tocados por nada aqui — apagar prova assinada é decisão do
 * controlador, nunca de um cron.
 *
 * Toda janela vem de `configuracoes`, mas todo campo tem padrão embutido: a
 * expurga precisa rodar sob política conhecida mesmo em banco recém-criado, e
 * um `NaN` escapando de uma configuração inválida apagaria tudo ou nada.
 *
 * O Pages não tem cron nativo — quem dispara é um agendador externo (GitHub
 * Actions). Se ele morrer, ninguém percebe: o sintoma é a AUSÊNCIA de deletes.
 * Daí `verificarSaudeLimpezaRetencao`, que deduz a última execução do próprio
 * `audit_log` (`acao='limpeza_retencao'`) em vez de criar tabela de controle, e
 * expõe o atraso no health detail. `avaliarSaudeLimpeza` é a parte pura, para
 * ser testável sem banco.
 */
import { and, lt, eq, desc, isNotNull, sql } from 'drizzle-orm';
import {
	sessoes,
	loginAttempts,
	doisFatoresTokens,
	resetSenhaTokens,
	assinaturaIntencoes,
	recoveryAttempts,
	webhookNonces,
	auditLog,
	auditCheckpoints,
	appLog
} from '../server/schema';
import { linhasAfetadas, timestampSqliteUtc, type Database } from './core';
import {
	buscarConfiguracao,
	LGPD_RETENCAO_SESSOES_DIAS,
	LGPD_RETENCAO_LOGIN_ATTEMPTS_DIAS,
	LGPD_RETENCAO_2FA_DIAS,
	LGPD_RETENCAO_RESET_TOKENS_DIAS,
	LGPD_RETENCAO_RECOVERY_ATTEMPTS_DIAS,
	LGPD_RETENCAO_WEBHOOK_NONCES_DIAS,
	LGPD_RETENCAO_AUDIT_LOG_ANOS,
	LGPD_RETENCAO_APP_LOG_DIAS
} from './configuracoes';

interface RetencaoConfig {
	sessoesDias: number;
	loginAttemptsDias: number;
	doisFatoresDias: number;
	resetTokensDias: number;
	recoveryAttemptsDias: number;
	webhookNoncesDias: number;
	/** Audit log fica em ANOS — default 5, prazo mínimo de Registros Públicos. */
	auditLogAnos: number;
	/** Logs técnicos (`app_log`) — diagnóstico operacional, TTL curto. */
	appLogDias: number;
}

interface ResultadoLimpeza {
	sessoes: number;
	loginAttempts: number;
	doisFatores: number;
	resetTokens: number;
	assinaturaIntencoes: number;
	recoveryAttempts: number;
	webhookNonces: number;
	auditLog: number;
	appLog: number;
}

/**
 * O limite de corte, nos DOIS formatos que as colunas de data usam — e é
 * obrigatório casar o formato com o da coluna, senão o corte erra em até 24h
 * (ver `timestampSqliteUtc` em `core.ts`).
 *
 * `cutoffISO` serve às colunas gravadas pelo APP com `toISOString()`:
 * `sessoes.expires_at`, `dois_fatores_tokens.expires_at`,
 * `reset_senha_tokens.expires_at`.
 *
 * `cutoffSqlite` serve às colunas com default `datetime('now')`:
 * `login_attempts.attempted_at`, `recovery_attempts.attempted_at`,
 * `webhook_nonces.received_at`, `audit_log.created_at`, `app_log.created_at`.
 * Ambas as convenções são UTC; a diferença é só de grafia.
 */
function cutoffISO(dias: number): string {
	return new Date(Date.now() - dias * 86_400_000).toISOString();
}

function cutoffSqlite(dias: number): string {
	return timestampSqliteUtc(Date.now() - dias * 86_400_000);
}

/**
 * Prazos de retenção configurados — em dias, exceto `auditLogAnos`, que fica em
 * anos por ser o único prazo definido por lei em anos.
 *
 * Todo campo tem padrão embutido (as oito consultas vão em paralelo, e cada
 * chave ausente cai no seu), então a expurga sempre roda sob política conhecida,
 * inclusive em banco recém-criado. `Number(x) || padrão` também absorve valor
 * inválido e zero: um `NaN` escapando daqui faria o cutoff apagar tudo ou nada.
 * Os padrões de cada campo estão justificados nos comentários ao lado.
 */
export async function carregarConfigRetencao(db: Database): Promise<RetencaoConfig> {
	const [
		sessoesDiasStr,
		loginDiasStr,
		doisFatoresDiasStr,
		resetDiasStr,
		recoveryDiasStr,
		noncesDiasStr,
		auditAnosStr,
		appLogDiasStr
	] = await Promise.all([
		buscarConfiguracao(db, LGPD_RETENCAO_SESSOES_DIAS),
		buscarConfiguracao(db, LGPD_RETENCAO_LOGIN_ATTEMPTS_DIAS),
		buscarConfiguracao(db, LGPD_RETENCAO_2FA_DIAS),
		buscarConfiguracao(db, LGPD_RETENCAO_RESET_TOKENS_DIAS),
		buscarConfiguracao(db, LGPD_RETENCAO_RECOVERY_ATTEMPTS_DIAS),
		buscarConfiguracao(db, LGPD_RETENCAO_WEBHOOK_NONCES_DIAS),
		buscarConfiguracao(db, LGPD_RETENCAO_AUDIT_LOG_ANOS),
		buscarConfiguracao(db, LGPD_RETENCAO_APP_LOG_DIAS)
	]);
	return {
		sessoesDias: Number(sessoesDiasStr) || 30,
		loginAttemptsDias: Number(loginDiasStr) || 90,
		doisFatoresDias: Number(doisFatoresDiasStr) || 1,
		resetTokensDias: Number(resetDiasStr) || 7,
		recoveryAttemptsDias: Number(recoveryDiasStr) || 90,
		// Webhook nonces só precisam viver enquanto a janela de replay (5 min).
		// Padrão de 7 dias é folga generosa contra clock skew / replays atrasados.
		webhookNoncesDias: Number(noncesDiasStr) || 7,
		// 5 anos é o piso da Lei de Registros Públicos para evidências
		// administrativas. Pode subir via configuração se a regulação
		// específica do contratante exigir mais.
		auditLogAnos: Number(auditAnosStr) || 5,
		// Logs técnicos são diagnóstico, não prova: 90 dias cobrem a investigação
		// de incidentes recentes sem acumular dado pessoal além do necessário.
		appLogDias: Number(appLogDiasStr) || 90
	};
}

/**
 * Corta o prefixo da trilha DEIXANDO ÂNCORA — FLW-AUDIT-005.
 *
 * A retenção sempre pôde apagar `audit_log` além do prazo; o que faltava era o
 * verificador conseguir distinguir esse corte de uma remoção para sumir com um
 * evento. Ele aceitava a primeira linha sobrevivente como início válido e
 * devolvia `ok: true` para as duas situações.
 *
 * O checkpoint fecha isso: guarda o último `seq` removido e o `hash_registro`
 * dele — que é exatamente o `hash_anterior` da primeira sobrevivente. Sem
 * checkpoint casando nos dois campos, o buraco volta a ser uma remoção não
 * explicada, e é o que `verificarIntegridadeAudit` passou a exigir.
 *
 * DELETE e checkpoint vão no MESMO `db.batch` (transação no D1). Fora dela,
 * uma falha entre os dois recria precisamente o estado do achado.
 *
 * Devolve quantas linhas saíram. Zero = nada a cortar, e nenhum checkpoint é
 * criado: checkpoint de corte vazio seria ruído numa tabela cuja utilidade é
 * ter exatamente uma linha por buraco.
 */
async function cortarTrilhaComAncora(
	db: Database,
	cutoff: string,
	politica: string
): Promise<number> {
	// A última linha que o corte vai levar. É dela que sai a âncora, então
	// precisa ser lida ANTES — depois do DELETE não existe mais.
	const ultima = await db
		.select({ seq: auditLog.seq, hash_registro: auditLog.hash_registro })
		.from(auditLog)
		.where(and(lt(auditLog.created_at, cutoff), isNotNull(auditLog.seq)))
		.orderBy(desc(auditLog.seq))
		.limit(1)
		.get();

	const [contagem] = await db
		.select({ n: sql<number>`count(*)` })
		.from(auditLog)
		.where(lt(auditLog.created_at, cutoff));
	const removidos = Number(contagem?.n ?? 0);
	if (removidos === 0) return 0;

	// Linha sem `seq` (as ~25 chamadas legadas anteriores ao encadeamento) não
	// participa da cadeia e não deixa buraco verificável: sai sem âncora.
	if (!ultima?.seq || !ultima.hash_registro) {
		const r = await db.delete(auditLog).where(lt(auditLog.created_at, cutoff));
		return linhasAfetadas(r) || removidos;
	}

	await db.batch([
		db.delete(auditLog).where(lt(auditLog.created_at, cutoff)),
		db.insert(auditCheckpoints).values({
			seq_ate: ultima.seq,
			hash_ate: ultima.hash_registro,
			removidos,
			politica
		})
	]);
	return removidos;
}

/**
 * Remove registros expirados.
 *
 * Tabelas temporárias (sessões, tokens, tentativas) saem por TTL curto.
 * Tabelas probatórias (`audit_log`) saem por TTL longo configurável — antes
 * do M-10 desta auditoria, `audit_log` crescia indefinidamente, violando o
 * princípio de minimização (LGPD art. 5º) e o direito ao esquecimento
 * (art. 16). Documentos e assinaturas continuam SEM purga automática
 * (valor jurídico exige decisão manual do controlador).
 */
export async function executarLimpezaRetencao(
	db: Database,
	config: RetencaoConfig
): Promise<ResultadoLimpeza> {
	const auditLogDias = config.auditLogAnos * 365;
	const [resSessoes, resLogin, res2FA, resReset, resIntencoes, resRecovery, resNonces, resAppLog] =
		await Promise.all([
			db.delete(sessoes).where(lt(sessoes.expires_at, cutoffISO(config.sessoesDias))),
			db
				.delete(loginAttempts)
				.where(lt(loginAttempts.attempted_at, cutoffSqlite(config.loginAttemptsDias))),
			db
				.delete(doisFatoresTokens)
				.where(lt(doisFatoresTokens.expires_at, cutoffISO(config.doisFatoresDias))),
			db
				.delete(resetSenhaTokens)
				.where(lt(resetSenhaTokens.expires_at, cutoffISO(config.resetTokensDias))),
			// Intenção de assinatura vive 15 min; some junto com os tokens de
			// reset porque é o mesmo tipo de dado — segredo de curta duração
			// atrelado a uma pessoa.
			db
				.delete(assinaturaIntencoes)
				.where(lt(assinaturaIntencoes.expires_at, cutoffISO(config.resetTokensDias))),
			db
				.delete(recoveryAttempts)
				.where(lt(recoveryAttempts.attempted_at, cutoffSqlite(config.recoveryAttemptsDias))),
			db
				.delete(webhookNonces)
				.where(lt(webhookNonces.received_at, cutoffSqlite(config.webhookNoncesDias))),
			db.delete(appLog).where(lt(appLog.created_at, cutoffSqlite(config.appLogDias)))
		]);

	// A trilha sai por último e SOZINHA: apagar o prefixo dela precisa deixar
	// âncora, e âncora e DELETE têm de cair juntos (ver `cortarTrilhaComAncora`).
	const auditRemovidos = await cortarTrilhaComAncora(
		db,
		cutoffSqlite(auditLogDias),
		`retencao:${config.auditLogAnos}anos`
	);

	return {
		sessoes: linhasAfetadas(resSessoes),
		loginAttempts: linhasAfetadas(resLogin),
		doisFatores: linhasAfetadas(res2FA),
		resetTokens: linhasAfetadas(resReset),
		assinaturaIntencoes: linhasAfetadas(resIntencoes),
		recoveryAttempts: linhasAfetadas(resRecovery),
		webhookNonces: linhasAfetadas(resNonces),
		auditLog: auditRemovidos,
		appLog: linhasAfetadas(resAppLog)
	};
}

/** Estado de saúde do cron de limpeza, derivado do último `audit_log`. */
export interface SaudeLimpezaRetencao {
	/** ISO do último `audit_log` com acao='limpeza_retencao', ou null se nunca rodou. */
	ultimaExecucao: string | null;
	/** Horas desde a última execução; null se nunca rodou. */
	horasDesdeUltima: number | null;
	/** true se passou do limite tolerado (cron provavelmente parado). */
	atrasada: boolean;
}

/**
 * Lógica pura do failsafe: dado o timestamp da última limpeza, decide se o cron
 * está atrasado. Separada da consulta para ser testável sem banco.
 *
 * @param ultimaExecucao ISO da última execução (aceita "YYYY-MM-DD HH:MM:SS"
 *   sem fuso, tratado como UTC), ou null se nunca rodou.
 * @param toleranciaHoras janela aceitável entre execuções.
 * @param agoraMs instante de referência (default `Date.now()`).
 */
export function avaliarSaudeLimpeza(
	ultimaExecucao: string | null,
	toleranciaHoras: number,
	agoraMs: number = Date.now()
): SaudeLimpezaRetencao {
	if (!ultimaExecucao) {
		return { ultimaExecucao: null, horasDesdeUltima: null, atrasada: true };
	}
	// created_at de datetime('now') vem sem fuso ("YYYY-MM-DD HH:MM:SS"): tratamos como UTC.
	const ms = Date.parse(
		ultimaExecucao.includes('T') ? ultimaExecucao : ultimaExecucao.replace(' ', 'T') + 'Z'
	);
	const horas = Number.isNaN(ms) ? null : (agoraMs - ms) / 3_600_000;
	return {
		ultimaExecucao,
		horasDesdeUltima: horas,
		atrasada: horas === null || horas > toleranciaHoras
	};
}

/**
 * Failsafe do cron de limpeza. O Cloudflare Pages não tem cron nativo: a
 * limpeza depende de um agendador externo (GitHub Actions). Se ele parar de
 * disparar, as tabelas de retenção crescem silenciosamente. Como cada execução
 * grava um `audit_log` (`acao='limpeza_retencao'`), basta consultar o mais
 * recente — sem nova tabela nem armazenamento extra. Exposto no health detail
 * para um monitor externo flagrar a defasagem.
 *
 * @param toleranciaHoras janela aceitável entre execuções (default 48h: o cron
 *   roda diariamente, então 48h dá folga para uma falha pontual).
 */
export async function verificarSaudeLimpezaRetencao(
	db: Database,
	toleranciaHoras = 48
): Promise<SaudeLimpezaRetencao> {
	const [ultimo] = await db
		.select({ created_at: auditLog.created_at })
		.from(auditLog)
		.where(eq(auditLog.acao, 'limpeza_retencao'))
		.orderBy(desc(auditLog.created_at))
		.limit(1);

	return avaliarSaudeLimpeza(ultimo?.created_at ?? null, toleranciaHoras);
}
