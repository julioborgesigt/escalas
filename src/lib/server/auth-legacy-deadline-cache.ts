/**
 * Cache server-side do `auth.legacy_password_deadline` — data até a qual o
 * sistema ainda aceita login com hashes SHA-256 sem salt (legado).
 *
 * Antes esse cache vivia in-memory (TTL 5 min por isolate do Worker), o que
 * tinha o sintoma clássico de cache multi-isolate: alterar o valor em D1
 * podia levar até 5 min PARA CADA isolate notar — e isolates novos
 * continuavam usando o default até a primeira leitura. P1.1 da auditoria.
 *
 * Agora usa a mesma estratégia de `cfg-ass-cache.ts`: Cache API edge do
 * Cloudflare (`caches.default`) com TTL declarado via `Cache-Control`.
 * Garante consistência entre isolates dentro do mesmo data center e
 * eventualmente entre datacenters (a Cache API é distribuída).
 *
 * Quando o valor é alterado em produção (insert/update em `configuracoes`),
 * chamar `invalidarLegacyPasswordDeadline()` para forçar próxima leitura
 * a ir ao D1. Sem isso, mudança propaga em até 5 min via TTL natural.
 */

import { buscarConfiguracao } from '$lib/db/configuracoes';
import type { Database } from '$lib/db/core';

const LEGACY_PASSWORD_DEADLINE_DEFAULT_ISO = '2026-07-01T00:00:00Z';

const CHAVE = 'auth.legacy_password_deadline';
const CACHE_KEY = 'https://internal.escalas.local/auth-legacy-deadline/v1';
const TTL_SECONDS = 300;

function parseDeadlineIso(iso: string): Date {
	const d = new Date(iso);
	if (!Number.isFinite(d.getTime())) {
		return new Date(LEGACY_PASSWORD_DEADLINE_DEFAULT_ISO);
	}
	return d;
}

function makeRequest(): Request {
	return new Request(CACHE_KEY, { method: 'GET' });
}

function safeCacheRef(): Cache | null {
	// `caches.default` é uma extensão do runtime Cloudflare Workers, ausente da
	// lib DOM padrão. Em ambiente de teste/CI sem Workers, `caches` pode não
	// existir — fallback para null (e o caller cai direto no D1).
	if (typeof caches === 'undefined') return null;
	const c = caches as unknown as { default?: Cache };
	return c.default ?? null;
}

/**
 * Deadline para aceitar hash de senha legado (SHA-256). Cache edge 5 min;
 * em miss, lê do D1. Sempre devolve uma `Date` válida (cai no default se
 * a string em `configuracoes` for malformada).
 */
export async function getLegacyPasswordDeadline(db: Database): Promise<Date> {
	const cache = safeCacheRef();
	if (cache) {
		try {
			const hit = await cache.match(makeRequest());
			if (hit) {
				const iso = (await hit.text()).trim();
				if (iso) return parseDeadlineIso(iso);
			}
		} catch {
			// cache miss / runtime sem Cache API — cai no D1
		}
	}

	const row = await buscarConfiguracao(db, CHAVE);
	const iso = row?.trim() || LEGACY_PASSWORD_DEADLINE_DEFAULT_ISO;

	if (cache) {
		try {
			const response = new Response(iso, {
				headers: {
					'Content-Type': 'text/plain; charset=utf-8',
					'Cache-Control': `max-age=${TTL_SECONDS}`
				}
			});
			await cache.put(makeRequest(), response);
		} catch {
			// se cache.put falhar, segue sem cache — TTL natural cuidará disso
		}
	}

	return parseDeadlineIso(iso);
}

/** Quando não há `db` (ex.: testes unitários sem SQLite). */
export function getLegacyPasswordDeadlineDefault(): Date {
	return parseDeadlineIso(LEGACY_PASSWORD_DEADLINE_DEFAULT_ISO);
}

/**
 * Invalida o cache edge — chamar APÓS alterar `auth.legacy_password_deadline`
 * em `configuracoes`. Não há rota da UI que faça isso hoje (configuração
 * manual via D1), mas a função fica disponível para quando houver.
 */
async function invalidarLegacyPasswordDeadline(): Promise<void> {
	const cache = safeCacheRef();
	if (!cache) return;
	try {
		await cache.delete(makeRequest());
	} catch {
		// silently ignore — TTL natural absorve em <= 5min
	}
}
