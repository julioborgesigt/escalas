/**
 * Cache server-side do "papel GISE" (supervisor / membro) de cada policial.
 *
 * O `+layout.server.ts` consulta essas duas flags em **toda navegação** para
 * desenhar o menu lateral. Sem cache, cada navegação executa 2 queries no D1
 * — desperdício, já que o papel GISE de um policial muda raramente.
 *
 * Aqui usamos `caches.default` (Cache API edge do Cloudflare) com TTL curto
 * de 60s. O risco de "stale UI" por até 1 minuto é aceitável para um menu de
 * navegação. Mutações diretas (mudar supervisor, adicionar/remover membro)
 * invalidam o cache explicitamente para resposta imediata.
 *
 * Mutações em cascata raras (ex.: deletar uma seccional inteira) não chamam
 * a invalidação explícita; o TTL absorve em até 60s.
 */

import { eq } from 'drizzle-orm';
import {
	isSupervisorGiseAtiva,
	isMembroGiseAtiva,
	isSupervisaoGiseAtiva,
	type Database
} from '$lib/db';
import { giseEscalas, giseEquipes, giseMembros, giseSeccionais } from '$lib/server/schema';

interface PapelGise {
	isSupervisor: boolean;
	isMembro: boolean;
	/** Assessor ou SEINT no quadro de supervisão (GISE ativa). */
	isSupervisao: boolean;
}

const TTL_SECONDS = 60;

function makeRequest(policialId: number): Request {
	return new Request(`https://internal.escalas.local/gise-papel/v1/${policialId}`, {
		method: 'GET'
	});
}

function safeCacheRef(): Cache | null {
	if (typeof caches === 'undefined') return null;
	const c = caches as unknown as { default?: Cache };
	return c.default ?? null;
}

/**
 * Lê o papel GISE do policial. Em miss, consulta o D1 (2 queries em paralelo)
 * e popula o cache.
 */
export async function lerPapelGise(db: Database, policialId: number): Promise<PapelGise> {
	const cache = safeCacheRef();

	if (cache) {
		try {
			const hit = await cache.match(makeRequest(policialId));
			if (hit) {
				return (await hit.json()) as PapelGise;
			}
		} catch {
			// segue para o DB
		}
	}

	const [isSupervisor, isMembro, isSupervisao] = await Promise.all([
		isSupervisorGiseAtiva(db, policialId),
		isMembroGiseAtiva(db, policialId),
		isSupervisaoGiseAtiva(db, policialId)
	]);

	const papel: PapelGise = { isSupervisor, isMembro, isSupervisao };

	if (cache) {
		try {
			const response = new Response(JSON.stringify(papel), {
				headers: {
					'Content-Type': 'application/json',
					'Cache-Control': `max-age=${TTL_SECONDS}`
				}
			});
			await cache.put(makeRequest(policialId), response);
		} catch {
			// se falhar, o próximo request paga a query e tenta de novo
		}
	}

	return papel;
}

/**
 * Invalida o cache para um único policial. Use após:
 *  - alteração direta de `supervisor_id` em uma escala GISE,
 *  - adição/remoção do policial como membro de equipe.
 *
 * Aceita `null`/`undefined` por conveniência (ex.: supervisor antigo pode não existir).
 */
export async function invalidarPapelGise(policialId: number | null | undefined): Promise<void> {
	if (policialId == null) return;
	const cache = safeCacheRef();
	if (!cache) return;
	try {
		await cache.delete(makeRequest(policialId));
	} catch {
		// silently ignore — TTL natural cuidará disso em <= 60s
	}
}

/** Invalida o cache para vários policiais de uma vez (best-effort). */
export async function invalidarPapelGiseMultiplos(
	policialIds: ReadonlyArray<number | null | undefined>
): Promise<void> {
	const cache = safeCacheRef();
	if (!cache) return;
	const ids = policialIds.filter((id): id is number => typeof id === 'number');
	if (ids.length === 0) return;
	await Promise.allSettled(ids.map((id) => cache.delete(makeRequest(id))));
}

/**
 * Coleta IDs de policiais cujo papel GISE pode mudar quando a escala inteira
 * muda de status (`finalizada`, reabertura) ou é excluída. Usar antes da
 * mutação para passar o resultado a `invalidarPapelGiseMultiplos`.
 */
export async function coletarAfetadosGise(db: Database, giseId: number): Promise<number[]> {
	const ids = new Set<number>();

	const [quadro, membros] = await Promise.all([
		db
			.select({
				supervisor_id: giseEscalas.supervisor_id,
				assessor_id: giseEscalas.assessor_id,
				seint1_id: giseEscalas.seint1_id,
				seint2_id: giseEscalas.seint2_id
			})
			.from(giseEscalas)
			.where(eq(giseEscalas.id, giseId))
			.get(),
		db
			.select({ id: giseMembros.policial_id })
			.from(giseMembros)
			.innerJoin(giseEquipes, eq(giseMembros.equipe_id, giseEquipes.id))
			.innerJoin(giseSeccionais, eq(giseEquipes.gise_seccional_id, giseSeccionais.id))
			.where(eq(giseSeccionais.gise_id, giseId))
			.all()
	]);

	if (quadro?.supervisor_id != null) ids.add(quadro.supervisor_id);
	if (quadro?.assessor_id != null) ids.add(quadro.assessor_id);
	if (quadro?.seint1_id != null) ids.add(quadro.seint1_id);
	if (quadro?.seint2_id != null) ids.add(quadro.seint2_id);
	for (const m of membros) ids.add(m.id);

	return Array.from(ids);
}
