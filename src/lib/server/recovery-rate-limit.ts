/**
 * Rate-limit dedicado aos fluxos de recuperação (solicitar/confirmar redefinição
 * de senha, primeiro acesso). Isolado de `login_attempts` para que requests de
 * reset NÃO inflem o contador de logins falhos do mesmo IP — antes, atacante
 * podia disparar resets para bloquear o login legítimo de usuários daquela rede.
 */

import { and, count, eq, gt } from 'drizzle-orm';
import { recoveryAttempts } from './schema';
import type { Database } from '$lib/db';
import { anonimizarIp } from '$lib/db/audit';

export type RecoveryPurpose = 'solicitar_redefinicao' | 'confirmar_redefinicao' | 'primeiro_acesso';

/**
 * Conta tentativas do IP para um propósito específico dentro da janela.
 * Retorna `{ blocked, count }` — caller decide se bloqueia ou só registra.
 */
export async function contarRecoveryAttempts(
	db: Database,
	ip: string,
	purpose: RecoveryPurpose,
	windowMinutes: number,
	max: number
): Promise<{ blocked: boolean; count: number }> {
	const since = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();
	const ipNormalized = anonimizarIp(ip) ?? ip;
	const [row] = await db
		.select({ n: count() })
		.from(recoveryAttempts)
		.where(
			and(
				eq(recoveryAttempts.ip, ipNormalized),
				eq(recoveryAttempts.purpose, purpose),
				gt(recoveryAttempts.attempted_at, since)
			)
		);
	const c = row?.n ?? 0;
	return { blocked: c >= max, count: c };
}

/**
 * Registra uma tentativa do IP. IP é anonimizado (LGPD) antes do INSERT.
 */
export async function registrarRecoveryAttempt(
	db: Database,
	ip: string,
	purpose: RecoveryPurpose
): Promise<void> {
	await db.insert(recoveryAttempts).values({
		ip: anonimizarIp(ip) ?? ip,
		purpose
	});
}
