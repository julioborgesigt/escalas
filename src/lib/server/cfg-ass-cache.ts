/**
 * Cache server-side das flags de configuração de assinatura.
 *
 * Antes, essas flags eram cacheadas em um cookie do cliente (`cfg_ass`) com
 * `httpOnly: false`. Isso permitia ao usuário editar o cookie no devtools e
 * desligar exigências de selfie/GPS/código por e-mail antes de chamar os
 * endpoints de assinatura — quebrando a cadeia de evidência.
 *
 * Agora as flags vivem na **Cache API edge do Cloudflare** (`caches.default`),
 * com TTL de 5 minutos. O cliente nunca lê nem escreve a flag; ela é decisão
 * exclusiva do servidor. Os endpoints de assinatura DEVEM usar
 * `lerFlagsAssinatura(platform)` antes de aceitar/dispensar selfie, GPS ou
 * código por e-mail — nunca confiar no que veio no `request.json()` ou no
 * `parentData` do load.
 *
 * Quando o admin altera as flags em `/api/configuracoes/assinatura`, chamamos
 * `invalidarFlagsAssinatura()` para forçar a próxima leitura a ir ao D1.
 */

import {
	buscarExigirFotoAssinatura,
	buscarExigirGpsAssinatura,
	buscarExigirCodigoEmailAssinatura,
	buscarRestringirSmartphone
} from '$lib/db';
import { getDB } from '$lib/db';

export interface FlagsAssinatura {
	exigirFotoAssinatura: boolean;
	exigirGpsAssinatura: boolean;
	exigirCodigoEmailAssinatura: boolean;
	restringirSmartphone: boolean;
}

const CACHE_KEY = 'https://internal.escalas.local/cfg-ass/v1';
const TTL_SECONDS = 300;

function makeRequest(): Request {
	return new Request(CACHE_KEY, { method: 'GET' });
}

function safeCacheRef(): Cache | null {
	// `caches.default` é uma extensão do runtime Cloudflare Workers, ausente da
	// lib DOM padrão. Em ambiente de teste/CI sem Workers, `caches` pode não
	// existir — fallback para null.
	if (typeof caches === 'undefined') return null;
	const c = caches as unknown as { default?: Cache };
	return c.default ?? null;
}

/** Lê as flags do cache edge; em miss, consulta o D1 e popula o cache. */
export async function lerFlagsAssinatura(
	platform: App.Platform | undefined
): Promise<FlagsAssinatura> {
	const cache = safeCacheRef();
	if (cache) {
		try {
			const hit = await cache.match(makeRequest());
			if (hit) {
				return (await hit.json()) as FlagsAssinatura;
			}
		} catch {
			// cache miss ou inacessível — segue para o DB
		}
	}

	const db = getDB(platform);
	const [foto, gps, _codigoBanco, smartphone] = await Promise.all([
		buscarExigirFotoAssinatura(db),
		buscarExigirGpsAssinatura(db),
		buscarExigirCodigoEmailAssinatura(db),
		buscarRestringirSmartphone(db)
	]);

	const flags: FlagsAssinatura = {
		exigirFotoAssinatura: foto,
		exigirGpsAssinatura: gps,
		// 2FA por e-mail é requisito MÍNIMO da assinatura avançada
		// (Lei 14.063/2020 art. 4º II "b"). Tratamos como sempre `true` mesmo
		// que o D1 contenha "0" por migração antiga ou bypass administrativo
		// direto no banco — a UI bloqueia desligar e o endpoint PUT rejeita
		// `false`. Documentado em signature-level.ts.
		exigirCodigoEmailAssinatura: true,
		restringirSmartphone: smartphone
	};

	if (cache) {
		try {
			const response = new Response(JSON.stringify(flags), {
				headers: {
					'Content-Type': 'application/json',
					'Cache-Control': `max-age=${TTL_SECONDS}`
				}
			});
			await cache.put(makeRequest(), response);
		} catch {
			// se cache.put falhar (workers env restrito), tudo bem — só perde o cache
		}
	}

	return flags;
}

/** Invalida o cache. Deve ser chamado após qualquer mutação em `/api/configuracoes/assinatura`. */
export async function invalidarFlagsAssinatura(): Promise<void> {
	const cache = safeCacheRef();
	if (!cache) return;
	try {
		await cache.delete(makeRequest());
	} catch {
		// silently ignore — TTL natural cuidará disso em <= 5 min
	}
}
