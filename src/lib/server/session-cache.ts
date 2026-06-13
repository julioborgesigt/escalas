/**
 * Cache server-side (Cache API edge do Cloudflare) da sessão validada,
 * incluindo o resultado da checagem de aceite do Termo de Uso.
 *
 * Motivação (auditoria de performance, B-1 camada 2): mesmo com o batch de
 * `validarSessaoComAceite`, todo request autenticado pagava 2 round-trips ao
 * D1 (sessão; usuário+aceite). Com este cache, a maioria dos requests dentro
 * da janela de 60s não toca o banco para autenticação.
 *
 * Trade-offs conscientes (mesma família do gise-papel-cache, TTL 60s):
 *  - Revogação: uma sessão excluída/expirada ou um usuário desativado podem
 *    continuar válidos por até 60s. O logout invalida explicitamente NO COLO
 *    que atendeu o request; o Cache API é por data center, então um token
 *    roubado usado em outro colo mantém a janela de 60s. Aceito para 60s.
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

interface SessaoCacheada {
	usuario: UsuarioLogado;
	aceiteVigente: boolean;
}

const TTL_SECONDS = 60;

async function chaveCache(token: string): Promise<Request> {
	const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
	const hex = Array.from(new Uint8Array(buf))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
	return new Request(`https://internal.escalas.local/sessao/v1/${hex}`, { method: 'GET' });
}

function safeCacheRef(): Cache | null {
	if (typeof caches === 'undefined') return null;
	const c = caches as unknown as { default?: Cache };
	return c.default ?? null;
}

export async function lerSessaoCache(token: string): Promise<SessaoCacheada | null> {
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
export async function gravarSessaoCache(token: string, valor: SessaoCacheada): Promise<void> {
	const cache = safeCacheRef();
	if (!cache) return;
	try {
		const response = new Response(JSON.stringify(valor), {
			headers: {
				'Content-Type': 'application/json',
				'Cache-Control': `max-age=${TTL_SECONDS}`
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
