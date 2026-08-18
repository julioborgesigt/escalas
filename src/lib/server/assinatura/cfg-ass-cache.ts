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
	buscarRestringirSmartphone,
	buscarExigirPasskeyAssinatura
} from '$lib/db';
import { getDB } from '$lib/db';
import { chaveEdge, lerJsonEdge, gravarJsonEdge, invalidarEdge } from '../edge-cache';

export interface FlagsAssinatura {
	exigirFotoAssinatura: boolean;
	exigirGpsAssinatura: boolean;
	exigirCodigoEmailAssinatura: boolean;
	restringirSmartphone: boolean;
	exigirPasskeyAssinatura: boolean;
}

// v2: o shape ganhou `exigirPasskeyAssinatura`. Sem trocar a chave, um hit da
// v1 (até 5 min após o deploy) devolveria `undefined` na flag nova — que é
// falsy, então o efeito seria "reforço desligado por 5 minutos" em vez de erro
// visível. Bump de chave é mais barato que caçar isso depois.
const CHAVE = chaveEdge('cfg-ass/v2');
const TTL_SECONDS = 300;

/** Lê as flags do cache edge; em miss, consulta o D1 e popula o cache. */
export async function lerFlagsAssinatura(
	platform: App.Platform | undefined
): Promise<FlagsAssinatura> {
	const hit = await lerJsonEdge<FlagsAssinatura>(CHAVE);
	if (hit) return hit;

	const db = getDB(platform);
	const [foto, gps, , smartphone, passkey] = await Promise.all([
		buscarExigirFotoAssinatura(db),
		buscarExigirGpsAssinatura(db),
		buscarExigirCodigoEmailAssinatura(db),
		buscarRestringirSmartphone(db),
		buscarExigirPasskeyAssinatura(db)
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
		restringirSmartphone: smartphone,
		exigirPasskeyAssinatura: passkey
	};

	await gravarJsonEdge(CHAVE, flags, TTL_SECONDS);

	return flags;
}

/** Invalida o cache. Deve ser chamado após qualquer mutação em `/api/configuracoes/assinatura`. */
export async function invalidarFlagsAssinatura(): Promise<void> {
	await invalidarEdge(CHAVE);
}
