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

export type RecoveryPurpose =
	| 'solicitar_redefinicao'
	| 'confirmar_redefinicao'
	| 'primeiro_acesso'
	// Reuso da mesma tabela genérica (ip, purpose, attempted_at) para throttle por
	// IP de endpoints sensíveis sem sessão — isolados por purpose (ver schema.ts):
	| 'validar_download' // download público de /validar
	| 'verificar_2fa' // brute-force do código 2FA no login
	| 'reenviar_codigo' // reenvio de 2FA (reset do contador + e-mail bombing)
	| 'solicitar_codigo_assinatura' // envio do código 2FA de assinatura (e-mail bombing / quota)
	| 'alterar_senha'; // brute-force da senha atual com sessão roubada (chave por usuário, não IP)

/**
 * Chave de rate-limit derivada do IP.
 *
 * Com `RATE_LIMIT_IP_SALT` definido (wrangler secret), usa hash SHA-256
 * salteado do IP COMPLETO — granularidade por endereço, sem persistir o IP em
 * claro (LGPD ok: pseudonimizado com segredo do operador). Sem o salt, cai no
 * comportamento legado `anonimizarIp` (/24), que tem um efeito colateral
 * conhecido: 5 falhas bloqueiam a /24 inteira (ex.: o NAT da corporação) —
 * tanto DoS barato quanto lockout mútuo de usuários legítimos.
 *
 * Aceita também chaves sintéticas não-IP (ex.: `senha-atual:policial:42`)
 * para throttle por usuário: passam intactas sem salt, hasheadas com salt.
 */
export async function chaveRateLimitIp(ip: string): Promise<string> {
	const salt =
		typeof process !== 'undefined' ? process.env?.RATE_LIMIT_IP_SALT?.trim() : undefined;
	if (!salt) return anonimizarIp(ip) ?? ip;
	const data = new TextEncoder().encode(`${salt}\x1f${ip}`);
	const buf = await crypto.subtle.digest('SHA-256', data);
	const hex = Array.from(new Uint8Array(buf))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
	return `iph:${hex.slice(0, 40)}`;
}

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
	const ipNormalized = await chaveRateLimitIp(ip);
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
 * Registra uma tentativa do IP. A chave é pseudonimizada/anonimizada (LGPD)
 * por `chaveRateLimitIp` antes do INSERT.
 */
export async function registrarRecoveryAttempt(
	db: Database,
	ip: string,
	purpose: RecoveryPurpose
): Promise<void> {
	await db.insert(recoveryAttempts).values({
		ip: await chaveRateLimitIp(ip),
		purpose
	});
}
