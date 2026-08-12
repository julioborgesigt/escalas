/**
 * Chave/valor de `configuracoes`: retenção LGPD (art. 16), provedor de e-mail
 * e flags de evidência da assinatura. Valores são TEXTO; quem lê converte.
 */
import { eq, sql } from 'drizzle-orm';
import { configuracoes } from '../server/schema';
import type { Database } from './core';

// Chaves de configuração de retenção de dados (LGPD art. 16)
export const LGPD_RETENCAO_SESSOES_DIAS = 'lgpd.retencao.sessoes_dias';
export const LGPD_RETENCAO_LOGIN_ATTEMPTS_DIAS = 'lgpd.retencao.login_attempts_dias';
export const LGPD_RETENCAO_2FA_DIAS = 'lgpd.retencao.dois_fatores_dias';
export const LGPD_RETENCAO_RESET_TOKENS_DIAS = 'lgpd.retencao.reset_tokens_dias';
export const LGPD_RETENCAO_AUDIT_LOG_ANOS = 'lgpd.retencao.audit_log_anos';
export const LGPD_RETENCAO_RECOVERY_ATTEMPTS_DIAS = 'lgpd.retencao.recovery_attempts_dias';
export const LGPD_RETENCAO_WEBHOOK_NONCES_DIAS = 'lgpd.retencao.webhook_nonces_dias';
export const LGPD_RETENCAO_APP_LOG_DIAS = 'lgpd.retencao.app_log_dias';

/** Provedor de e-mail padrão (o outro assume por fallback quando este falha/extrapola cota). */
export const EMAIL_PROVEDOR_PADRAO = 'email.provedor_padrao';
export type EmailProvedor = 'cloudflare' | 'resend';

/**
 * Valor bruto da chave, ou `null` se nunca foi salva — todo leitor precisa ter
 * um padrão próprio para esse caso (ver as flags abaixo). `configuracoes` é
 * chave/valor em TEXTO: números e JSON são convertidos por quem lê.
 */
export async function buscarConfiguracao(db: Database, chave: string): Promise<string | null> {
	const row = await db.select().from(configuracoes).where(eq(configuracoes.chave, chave)).get();
	return row?.valor ?? null;
}

/**
 * Grava a chave (upsert). Não valida nem a chave nem o formato do valor: quem
 * chama é dono do contrato de leitura correspondente.
 */
export async function salvarConfiguracao(
	db: Database,
	chave: string,
	valor: string
): Promise<void> {
	await db
		.insert(configuracoes)
		.values({ chave, valor })
		.onConflictDoUpdate({
			target: configuracoes.chave,
			set: { valor, updated_at: sql`(datetime('now', '-3 hours'))` }
		});
}

/** Lê a flag booleana "exigir_foto_assinatura" (padrão: true). */
export async function buscarExigirFotoAssinatura(db: Database): Promise<boolean> {
	const val = await buscarConfiguracao(db, 'exigir_foto_assinatura');
	return val !== '0'; // qualquer coisa diferente de '0' = true
}

/** Lê a flag booleana "exigir_gps_assinatura" (padrão: true). */
export async function buscarExigirGpsAssinatura(db: Database): Promise<boolean> {
	const val = await buscarConfiguracao(db, 'exigir_gps_assinatura');
	return val !== '0';
}

/** Lê a flag booleana "exigir_codigo_email_assinatura" (padrão: false). */
export async function buscarExigirCodigoEmailAssinatura(db: Database): Promise<boolean> {
	const val = await buscarConfiguracao(db, 'exigir_codigo_email_assinatura');
	return val === '1'; // Default = false, requires explicit '1' to be true
}

/** Lê a flag booleana "restringir_smartphone" (padrão: true). */
export async function buscarRestringirSmartphone(db: Database): Promise<boolean> {
	const val = await buscarConfiguracao(db, 'restringir_smartphone');
	return val !== '0'; // Default = true (current system behavior)
}

/** Provedor de e-mail padrão. Default 'cloudflare' (comportamento histórico). */
export async function buscarProvedorEmailPadrao(db: Database): Promise<EmailProvedor> {
	const val = await buscarConfiguracao(db, EMAIL_PROVEDOR_PADRAO);
	return val === 'resend' ? 'resend' : 'cloudflare';
}
