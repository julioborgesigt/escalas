import { lt } from 'drizzle-orm';
import { sessoes, loginAttempts, doisFatoresTokens, resetSenhaTokens } from '../server/schema';
import type { Database } from './core';
import {
	buscarConfiguracao,
	LGPD_RETENCAO_SESSOES_DIAS,
	LGPD_RETENCAO_LOGIN_ATTEMPTS_DIAS,
	LGPD_RETENCAO_2FA_DIAS,
	LGPD_RETENCAO_RESET_TOKENS_DIAS
} from './configuracoes';

interface RetencaoConfig {
	sessoesDias: number;
	loginAttemptsDias: number;
	doisFatoresDias: number;
	resetTokensDias: number;
}

interface ResultadoLimpeza {
	sessoes: number;
	loginAttempts: number;
	doisFatores: number;
	resetTokens: number;
}

function cutoffISO(dias: number): string {
	return new Date(Date.now() - dias * 86_400_000).toISOString();
}

export async function carregarConfigRetencao(db: Database): Promise<RetencaoConfig> {
	const [sessoesDiasStr, loginDiasStr, doisFatoresDiasStr, resetDiasStr] = await Promise.all([
		buscarConfiguracao(db, LGPD_RETENCAO_SESSOES_DIAS),
		buscarConfiguracao(db, LGPD_RETENCAO_LOGIN_ATTEMPTS_DIAS),
		buscarConfiguracao(db, LGPD_RETENCAO_2FA_DIAS),
		buscarConfiguracao(db, LGPD_RETENCAO_RESET_TOKENS_DIAS)
	]);
	return {
		sessoesDias:        Number(sessoesDiasStr)       || 30,
		loginAttemptsDias:  Number(loginDiasStr)         || 90,
		doisFatoresDias:    Number(doisFatoresDiasStr)   || 1,
		resetTokensDias:    Number(resetDiasStr)          || 7
	};
}

/**
 * Remove registros expirados de tabelas temporárias (sessões, tokens, tentativas de login).
 * Tabelas com valor probatório (audit_log, documentos, assinaturas) não são afetadas —
 * a retenção mínima de 5 anos deve ser controlada manualmente.
 */
export async function executarLimpezaRetencao(
	db: Database,
	config: RetencaoConfig
): Promise<ResultadoLimpeza> {
	const [resSessoes, resLogin, res2FA, resReset] = await Promise.all([
		db.delete(sessoes).where(lt(sessoes.expires_at, cutoffISO(config.sessoesDias))),
		db.delete(loginAttempts).where(lt(loginAttempts.attempted_at, cutoffISO(config.loginAttemptsDias))),
		db.delete(doisFatoresTokens).where(lt(doisFatoresTokens.expires_at, cutoffISO(config.doisFatoresDias))),
		db.delete(resetSenhaTokens).where(lt(resetSenhaTokens.expires_at, cutoffISO(config.resetTokensDias)))
	]);

	return {
		sessoes:       resSessoes.rowsAffected ?? 0,
		loginAttempts: resLogin.rowsAffected   ?? 0,
		doisFatores:   res2FA.rowsAffected     ?? 0,
		resetTokens:   resReset.rowsAffected   ?? 0
	};
}
