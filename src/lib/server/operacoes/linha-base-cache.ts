/**
 * Cache server-side de "este admin tem base a informar?" — a flag que decide se
 * a aba **Dados base** aparece na barra lateral.
 *
 * Mesma razão de `gise/papel-cache.ts`: o `+layout.server.ts` precisa da resposta
 * em **toda navegação**, e a resposta é cara. Ela cruza as operações ativas, os
 * modelos de formulário das duas equipes de cada uma e a participação das
 * unidades administradas — um join de três tabelas por operação. Sem cache, cada
 * clique no menu paga isso.
 *
 * TTL de 60s, sem invalidação explícita. É deliberado: a flag só muda quando uma
 * escala nova inclui a unidade numa operação ou quando um indicador percentual é
 * criado no editor — eventos raros, e em nenhum deles um minuto de menu
 * desatualizado tem consequência. A tela em si nunca depende deste cache: quem
 * autoriza `/dados-base` é `unidadesLinhaBaseAdministradas`, consultado ao vivo.
 */

import { temLinhaBaseAPreencher } from './permissao';
import type { Database } from '$lib/db';

const TTL_SECONDS = 60;

function makeRequest(policialId: number): Request {
	return new Request(`https://internal.escalas.local/linha-base-pendente/v1/${policialId}`, {
		method: 'GET'
	});
}

function safeCacheRef(): Cache | null {
	if (typeof caches === 'undefined') return null;
	const c = caches as unknown as { default?: Cache };
	return c.default ?? null;
}

/**
 * Lê a flag do cache; em miss, calcula e popula.
 *
 * Falha de cache nunca derruba a navegação — cai para o cálculo direto, que é o
 * mesmo resultado, só mais caro.
 */
export async function lerTemLinhaBasePendente(
	db: Database,
	u: App.Locals['usuario']
): Promise<boolean> {
	if (!u || u.tipo !== 'policial') return false;

	const cache = safeCacheRef();
	if (cache) {
		try {
			const hit = await cache.match(makeRequest(u.id));
			if (hit) return ((await hit.json()) as { tem: boolean }).tem;
		} catch {
			// segue para o cálculo
		}
	}

	const tem = await temLinhaBaseAPreencher(db, u);

	if (cache) {
		try {
			await cache.put(
				makeRequest(u.id),
				new Response(JSON.stringify({ tem }), {
					headers: {
						'Content-Type': 'application/json',
						'Cache-Control': `max-age=${TTL_SECONDS}`
					}
				})
			);
		} catch {
			// se falhar, o próximo request paga a consulta e tenta de novo
		}
	}

	return tem;
}
