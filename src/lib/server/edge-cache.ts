/**
 * Acesso à Cache API do edge (`caches.default`), compartilhado pelos quatro
 * caches do projeto: sessão (`auth/session-cache`), papel GISE
 * (`gise/papel-cache`), flags de assinatura (`assinatura/cfg-ass-cache`) e
 * pendência de linha de base (`operacoes/linha-base-cache`).
 *
 * Os quatro escreviam o mesmo `safeCacheRef` e os mesmos três `try/catch` em
 * volta de `match`/`put`/`delete`. A repetição não era estética: o contrato
 * embutido nela é que **falha de cache nunca propaga**. Cache aqui é sempre
 * otimização — a resposta correta está no D1, e um `caches` ausente (CI, teste,
 * `vitest`) ou um `put` recusado por ambiente restrito precisa cair no cálculo
 * direto em silêncio, nunca derrubar navegação, login ou assinatura.
 *
 * Quem chama continua dono de DUAS decisões que não sobem para cá, porque
 * variam por caso e já causaram incidente quando implícitas:
 *
 * - **A chave** (`chaveEdge`), incluindo o sufixo de versão. Trocar o shape do
 *   JSON sem trocar a chave serve dado velho pelo TTL inteiro, e campo novo
 *   ausente lê como `undefined` — falsy, isto é, "reforço desligado" em vez de
 *   erro visível (foi o motivo do `v2` em `cfg-ass` e em `gise-papel`).
 * - **O que pode ser cacheado.** `session-cache` grava só sessão VÁLIDA;
 *   resultado negativo nunca entra.
 */

/**
 * Referência à `caches.default`, ou `null` onde ela não existe.
 *
 * `caches.default` é extensão do runtime Cloudflare Workers e não está na lib
 * DOM padrão — daí o cast. Em teste/CI sem Workers, `caches` pode não existir.
 */
function refCache(): Cache | null {
	if (typeof caches === 'undefined') return null;
	const c = caches as unknown as { default?: Cache };
	return c.default ?? null;
}

/**
 * Monta a chave de cache a partir de um caminho.
 *
 * O host `internal.escalas.local` não resolve e não é alcançável: a Cache API
 * exige uma `Request` como chave, e esta URL existe só para nomear a entrada.
 *
 * @param caminho caminho COM versão, ex.: `gise-papel/v2/${policialId}`.
 *   Versione ao mudar o shape do JSON (ver cabeçalho do módulo).
 */
export function chaveEdge(caminho: string): Request {
	return new Request(`https://internal.escalas.local/${caminho}`, { method: 'GET' });
}

/**
 * Lê e desserializa uma entrada. `null` para MISS, cache ausente ou JSON
 * inválido — o chamador não distingue os três, porque em todos a ação é a
 * mesma: calcular de novo.
 */
export async function lerJsonEdge<T>(chave: Request): Promise<T | null> {
	const cache = refCache();
	if (!cache) return null;
	try {
		const hit = await cache.match(chave);
		if (!hit) return null;
		return (await hit.json()) as T;
	} catch {
		return null; // segue para o cálculo/DB
	}
}

/**
 * Grava a entrada com `max-age=ttlSeconds`. Best-effort: se falhar, o próximo
 * request paga a consulta e tenta de novo.
 */
export async function gravarJsonEdge(
	chave: Request,
	valor: unknown,
	ttlSeconds: number
): Promise<void> {
	const cache = refCache();
	if (!cache) return;
	try {
		await cache.put(
			chave,
			new Response(JSON.stringify(valor), {
				headers: {
					'Content-Type': 'application/json',
					'Cache-Control': `max-age=${ttlSeconds}`
				}
			})
		);
	} catch {
		// ambiente restrito recusa `put` — só perde o cache
	}
}

/** Remove a entrada (best-effort). Em falha, o TTL natural resolve. */
export async function invalidarEdge(chave: Request): Promise<void> {
	const cache = refCache();
	if (!cache) return;
	try {
		await cache.delete(chave);
	} catch {
		// silently ignore — TTL natural cuidará disso
	}
}

/** Remove várias entradas de uma vez (best-effort, sem parar na primeira falha). */
export async function invalidarEdgeMultiplos(chaves: readonly Request[]): Promise<void> {
	if (chaves.length === 0) return;
	const cache = refCache();
	if (!cache) return;
	await Promise.allSettled(chaves.map((c) => cache.delete(c)));
}
