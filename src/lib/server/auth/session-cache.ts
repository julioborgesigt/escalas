/**
 * Cache server-side (Cache API edge do Cloudflare) da sessão validada,
 * incluindo o resultado da checagem de aceite do Termo de Uso.
 *
 * Motivação (auditoria de performance, B-1 camada 2): mesmo com o batch de
 * `validarSessaoComAceite`, todo request autenticado pagava 2 round-trips ao
 * D1 (sessão; usuário+aceite). Com este cache, a maioria dos requests dentro
 * da janela de 60s não toca o banco para autenticação.
 *
 * Trade-offs conscientes (mesma família do papel-cache, TTL 60s default):
 *  - Revogação: uma sessão excluída/expirada ou um usuário desativado podem
 *    continuar válidos por até o TTL. O logout invalida explicitamente NO COLO
 *    que atendeu o request; o Cache API é por data center, então um token
 *    roubado usado em outro colo mantém a janela do TTL. O TTL é configurável
 *    via `SESSION_CACHE_TTL_SECONDS` (auditoria A5): reduza para encurtar a
 *    janela de revogação ou use `0` para desligar o cache (revalidação no D1
 *    a cada request — revogação imediata, ao custo de mais queries).
 *  - Sliding expiration: requests servidos do cache não estendem a sessão;
 *    o atraso máximo da extensão é o próprio TTL (60s em 8h de sessão).
 *  - Aceite do termo: o aceite registra-se uma vez e o fluxo invalida o cache
 *    na própria action (sem isso o usuário ficaria preso no redirect de
 *    /aceitar-termo por até 60s no mesmo colo).
 *  - Troca de senha: o fluxo rotaciona o token de sessão, então o novo token
 *    é cache-miss natural; a entrada antiga é invalidada por higiene.
 *
 * NUNCA usar o token cru como chave de cache: a chave é SHA-256 própria
 * (independente do formato de hash do banco — só precisa ser determinística).
 */

import type { UsuarioLogado } from '$lib/auth';
import { sha256Hex } from '$lib/crypto/digest';

interface SessaoCacheada {
	usuario: UsuarioLogado;
	aceiteVigente: boolean;
}

/** TTL padrão (s) quando `SESSION_CACHE_TTL_SECONDS` não está definido. */
const SESSION_CACHE_TTL_DEFAULT = 60;
/** Teto do TTL — acima disso a janela de revogação ficaria longa demais. */
const SESSION_CACHE_TTL_MAX = 300;

/**
 * Resolve o TTL do cache de sessão a partir de `SESSION_CACHE_TTL_SECONDS`
 * (wrangler var/secret), com clamp em [0, 300]. `0` DESLIGA o cache: toda
 * request autenticada revalida no D1, tornando a revogação (logout,
 * desativação, troca de papel) imediata ao custo de mais queries. Default 60s.
 */
export function resolverTtlCacheSessao(platform: App.Platform | undefined): number {
	const raw = (platform?.env as Record<string, string | undefined> | undefined)
		?.SESSION_CACHE_TTL_SECONDS;
	if (raw === undefined || raw === null || String(raw).trim() === '') {
		return SESSION_CACHE_TTL_DEFAULT;
	}
	const n = Number(raw);
	if (!Number.isFinite(n)) return SESSION_CACHE_TTL_DEFAULT;
	return Math.max(0, Math.min(SESSION_CACHE_TTL_MAX, Math.floor(n)));
}

async function chaveCache(token: string): Promise<Request> {
	const hex = await sha256Hex(token);
	return new Request(`https://internal.escalas.local/sessao/v1/${hex}`, { method: 'GET' });
}

function safeCacheRef(): Cache | null {
	if (typeof caches === 'undefined') return null;
	const c = caches as unknown as { default?: Cache };
	return c.default ?? null;
}

/**
 * Lê a sessão do cache do edge, ou `null` para MISS (o chamador cai no D1).
 *
 * A chave é o SHA-256 do token, nunca o token: entradas de cache podem ser
 * inspecionadas por operador, e uma delas com o token em claro seria uma sessão
 * sequestrável.
 *
 * `ttlSeconds <= 0` desliga o cache — é o botão de revogação imediata, para
 * quando derrubar sessão na hora importa mais que a latência. Toda falha
 * (ambiente sem `caches`, JSON inválido) devolve `null` em silêncio: cache é
 * otimização, e quebrá-lo não pode quebrar a autenticação.
 */
export async function lerSessaoCache(
	token: string,
	ttlSeconds: number = SESSION_CACHE_TTL_DEFAULT
): Promise<SessaoCacheada | null> {
	if (ttlSeconds <= 0) return null; // cache desligado por configuração (revogação imediata)
	const cache = safeCacheRef();
	if (!cache) return null;
	try {
		const hit = await cache.match(await chaveCache(token));
		if (!hit) return null;
		return (await hit.json()) as SessaoCacheada;
	} catch {
		return null; // segue para o DB
	}
}

/** Grava apenas sessões VÁLIDAS — resultado negativo nunca é cacheado. */
export async function gravarSessaoCache(
	token: string,
	valor: SessaoCacheada,
	ttlSeconds: number = SESSION_CACHE_TTL_DEFAULT
): Promise<void> {
	if (ttlSeconds <= 0) return; // cache desligado por configuração
	const cache = safeCacheRef();
	if (!cache) return;
	try {
		const response = new Response(JSON.stringify(valor), {
			headers: {
				'Content-Type': 'application/json',
				'Cache-Control': `max-age=${ttlSeconds}`
			}
		});
		await cache.put(await chaveCache(token), response);
	} catch {
		// se falhar, o próximo request paga as queries e tenta de novo
	}
}

/**
 * Invalida a entrada do token (best-effort, por colo). Use após:
 *  - logout (`excluirSessao`),
 *  - aceite do Termo de Uso (muda `aceiteVigente`),
 *  - troca de senha (token antigo deixa de valer).
 */
export async function invalidarSessaoCache(token: string | null | undefined): Promise<void> {
	if (!token) return;
	const cache = safeCacheRef();
	if (!cache) return;
	try {
		await cache.delete(await chaveCache(token));
	} catch {
		// silently ignore — TTL natural cuidará disso em <= 60s
	}
}
