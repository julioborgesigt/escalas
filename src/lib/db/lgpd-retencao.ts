import { lt } from 'drizzle-orm';
import {
	sessoes,
	loginAttempts,
	doisFatoresTokens,
	resetSenhaTokens,
	recoveryAttempts,
	webhookNonces,
	auditLog
} from '../server/schema';
import type { Database } from './core';
import {
	buscarConfiguracao,
	LGPD_RETENCAO_SESSOES_DIAS,
	LGPD_RETENCAO_LOGIN_ATTEMPTS_DIAS,
	LGPD_RETENCAO_2FA_DIAS,
	LGPD_RETENCAO_RESET_TOKENS_DIAS,
	LGPD_RETENCAO_RECOVERY_ATTEMPTS_DIAS,
	LGPD_RETENCAO_WEBHOOK_NONCES_DIAS,
	LGPD_RETENCAO_AUDIT_LOG_ANOS
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
}

interface ResultadoLimpeza {
	sessoes: number;
	loginAttempts: number;
	doisFatores: number;
	resetTokens: number;
	recoveryAttempts: number;
	webhookNonces: number;
	auditLog: number;
}

function cutoffISO(dias: number): string {
	return new Date(Date.now() - dias * 86_400_000).toISOString();
}

export async function carregarConfigRetencao(db: Database): Promise<RetencaoConfig> {
	const [
		sessoesDiasStr,
		loginDiasStr,
		doisFatoresDiasStr,
		resetDiasStr,
		recoveryDiasStr,
		noncesDiasStr,
		auditAnosStr
	] = await Promise.all([
		buscarConfiguracao(db, LGPD_RETENCAO_SESSOES_DIAS),
		buscarConfiguracao(db, LGPD_RETENCAO_LOGIN_ATTEMPTS_DIAS),
		buscarConfiguracao(db, LGPD_RETENCAO_2FA_DIAS),
		buscarConfiguracao(db, LGPD_RETENCAO_RESET_TOKENS_DIAS),
		buscarConfiguracao(db, LGPD_RETENCAO_RECOVERY_ATTEMPTS_DIAS),
		buscarConfiguracao(db, LGPD_RETENCAO_WEBHOOK_NONCES_DIAS),
		buscarConfiguracao(db, LGPD_RETENCAO_AUDIT_LOG_ANOS)
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
		auditLogAnos: Number(auditAnosStr) || 5
	};
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
	const [resSessoes, resLogin, res2FA, resReset, resRecovery, resNonces, resAudit] =
		await Promise.all([
			db.delete(sessoes).where(lt(sessoes.expires_at, cutoffISO(config.sessoesDias))),
			db
				.delete(loginAttempts)
				.where(lt(loginAttempts.attempted_at, cutoffISO(config.loginAttemptsDias))),
			db
				.delete(doisFatoresTokens)
				.where(lt(doisFatoresTokens.expires_at, cutoffISO(config.doisFatoresDias))),
			db
				.delete(resetSenhaTokens)
				.where(lt(resetSenhaTokens.expires_at, cutoffISO(config.resetTokensDias))),
			db
				.delete(recoveryAttempts)
				.where(lt(recoveryAttempts.attempted_at, cutoffISO(config.recoveryAttemptsDias))),
			db
				.delete(webhookNonces)
				.where(lt(webhookNonces.received_at, cutoffISO(config.webhookNoncesDias))),
			db.delete(auditLog).where(lt(auditLog.created_at, cutoffISO(auditLogDias)))
		]);

	return {
		sessoes: resSessoes.rowsAffected ?? 0,
		loginAttempts: resLogin.rowsAffected ?? 0,
		doisFatores: res2FA.rowsAffected ?? 0,
		resetTokens: resReset.rowsAffected ?? 0,
		recoveryAttempts: resRecovery.rowsAffected ?? 0,
		webhookNonces: resNonces.rowsAffected ?? 0,
		auditLog: resAudit.rowsAffected ?? 0
	};
}
