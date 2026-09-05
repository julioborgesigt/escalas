/**
 * Rate-limit dedicado aos fluxos de recuperação (solicitar/confirmar redefinição
 * de senha, primeiro acesso). Isolado de `login_attempts` para que requests de
 * reset NÃO inflem o contador de logins falhos do mesmo IP — antes, atacante
 * podia disparar resets para bloquear o login legítimo de usuários daquela rede.
 */

import { and, count, eq, gt } from 'drizzle-orm';
import { env as envPrivate } from '$env/dynamic/private';
import { sha256Hex } from '$lib/crypto/digest';
import { timestampSqliteUtc } from '$lib/db/core';
import { recoveryAttempts } from '../schema';
import type { Database } from '$lib/db';
import { anonimizarIp } from '$lib/db/audit';

type RecoveryPurpose =
	| 'solicitar_redefinicao'
	| 'confirmar_redefinicao'
	| 'primeiro_acesso'
	// Reuso da mesma tabela genérica (ip, purpose, attempted_at) para throttle por
	// IP de endpoints sensíveis sem sessão — isolados por purpose (ver schema.ts):
	| 'validar_download' // download público de /validar
	| 'validar_consulta' // consulta da PÁGINA de /validar (ver validar-rate-limit.ts)
	| 'verificar_2fa' // brute-force do código 2FA no login
	| 'reenviar_codigo' // reenvio de 2FA (reset do contador + e-mail bombing)
	| 'solicitar_codigo_assinatura' // envio do código 2FA de assinatura (e-mail bombing / quota)
	| 'alterar_senha' // brute-force da senha atual com sessão roubada (chave por usuário, não IP)
	| 'reauth_assinatura' // brute-force da senha na cerimônia de assinatura (chave por usuário)
	| 'passkey_reposicao' // e-mail bombing dos dois códigos de reposição da chave
	| 'geracao_pesada'; // teto de geração de PDF/export por CONTA (ver rate-limit-pesado.ts)

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
 *
 * **O salt vem de `$env/dynamic/private`, não de `process.env`** — e a
 * diferença já custou a proteção. No Cloudflare Pages, variável do painel
 * chega ao worker por `platform.env`, que o SvelteKit expõe nesse módulo;
 * `process.env` depende de flag/data de compatibilidade do runtime e é o
 * ÚNICO lugar de onde este arquivo lia. Ou funcionava por acidente da
 * `compatibility_date`, ou o salt nunca chegava aqui e o rate-limit caía no
 * `/24` em silêncio.
 *
 * O que tornava isso indetectável é que o failsafe olhava para o outro lado:
 * `/api/health?detail=` confere a presença de `RATE_LIMIT_IP_SALT` em
 * `platform.env` (`SEGREDOS_DE_PROTECAO`), então reportava `ok` para um valor
 * que o consumidor podia não estar vendo. As duas metades agora leem a mesma
 * fonte. `process.env` fica como fallback para script/teste fora do worker —
 * é o mesmo par que `cades-finalizer`, `server-seal` e `trust-store` usam.
 */
export async function chaveRateLimitIp(ip: string): Promise<string> {
	const salt = (
		envPrivate?.RATE_LIMIT_IP_SALT ??
		(typeof process !== 'undefined' ? process.env?.RATE_LIMIT_IP_SALT : undefined)
	)?.trim();
	if (!salt) return anonimizarIp(ip) ?? ip;
	const hex = await sha256Hex(`${salt}\x1f${ip}`);
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
	// `recovery_attempts.attempted_at` usa `datetime('now')`. Cortar com ISO
	// (`T` e `Z`) faz toda linha parecer anterior ao corte — o rate-limit
	// nunca dispara. Fonte única: `timestampSqliteUtc` em `$lib/db/core`.
	const since = timestampSqliteUtc(Date.now() - windowMinutes * 60 * 1000);
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
