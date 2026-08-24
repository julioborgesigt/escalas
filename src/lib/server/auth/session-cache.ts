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
 *  - Sliding expiration: request servida do cache não estende a sessão NO
 *    BANCO; o atraso máximo dessa extensão é o próprio TTL (60s em 1h de
 *    sessão). O COOKIE não depende disto — o `handleAuth` reemite o `maxAge`
 *    em toda request autenticada, cacheada ou não (LGPD A14).
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
import { chaveEdge, lerJsonEdge, gravarJsonEdge, invalidarEdge } from '../edge-cache';

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

/**
 * TTL efetivo do cache PARA ESTE request. Zero — cache desligado — quando o
 * método muta estado.
 *
 * Leitura pode estar até um TTL atrasada; **ação, não**. Dentro da janela — e o
 * Cache API é por colo, então um token usado em outro data center tem a janela
 * inteira — uma sessão revogada, uma senha trocada ou um policial desativado
 * continuavam ALTERANDO estado (FLW-AUTH-001). Revalidar custa um batch no D1,
 * e quem está mutando já paga vários; o ganho do cache está no caminho de
 * leitura, que é onde está o volume.
 *
 * A regra mora aqui, e não embutida no `hooks.server.ts`, porque é ELA que
 * produz a garantia — e o Cache API não funciona no preview local, então
 * nenhum teste de ponta a ponta consegue observar a diferença. O que dá para
 * fixar é a decisão.
 */
export function ttlCacheSessaoParaMetodo(
	platform: App.Platform | undefined,
	metodo: string
): number {
	return METODOS_QUE_MUTAM.has(metodo.toUpperCase()) ? 0 : resolverTtlCacheSessao(platform);
}

/** Métodos HTTP que mudam estado — os mesmos do guard de CSRF. */
const METODOS_QUE_MUTAM = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

async function chaveCache(token: string): Promise<Request> {
	return chaveEdge(`sessao/v1/${await sha256Hex(token)}`);
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
	return lerJsonEdge<SessaoCacheada>(await chaveCache(token));
}

/** Grava apenas sessões VÁLIDAS — resultado negativo nunca é cacheado. */
export async function gravarSessaoCache(
	token: string,
	valor: SessaoCacheada,
	ttlSeconds: number = SESSION_CACHE_TTL_DEFAULT
): Promise<void> {
	if (ttlSeconds <= 0) return; // cache desligado por configuração
	await gravarJsonEdge(await chaveCache(token), valor, ttlSeconds);
}

/**
 * Invalida a entrada do token (best-effort, por colo). Use após:
 *  - logout (`excluirSessao`),
 *  - aceite do Termo de Uso (muda `aceiteVigente`),
 *  - troca de senha (token antigo deixa de valer).
 */
export async function invalidarSessaoCache(token: string | null | undefined): Promise<void> {
	if (!token) return;
	await invalidarEdge(await chaveCache(token));
}
