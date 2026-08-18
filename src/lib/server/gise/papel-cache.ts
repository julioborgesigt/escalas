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
	chaveEdge,
	lerJsonEdge,
	gravarJsonEdge,
	invalidarEdge,
	invalidarEdgeMultiplos
} from '../edge-cache';
import {
	isSupervisorGiseAtiva,
	isMembroGiseAtiva,
	isSupervisaoGiseAtiva,
	temGiseHistorico,
	temPresencaGisePendente,
	type Database
} from '$lib/db';
import { giseEscalas, giseEquipes, giseMembros, giseSeccionais } from '$lib/server/schema';

interface PapelGise {
	isSupervisor: boolean;
	isMembro: boolean;
	/** Assessor ou SEINT no quadro de supervisão (GISE ativa). */
	isSupervisao: boolean;
	/** Tem ao menos uma participação GISE já encerrada — libera a aba "Histórico GISE". */
	temHistorico: boolean;
	/**
	 * Escalado em GISE ativa com entrada/saída ainda pendente — libera a aba
	 * "Presença GISE". Distinto de `isMembro`/`isSupervisao`/`isSupervisor`,
	 * que só dizem "está em escala ativa", não se ainda deve confirmar presença.
	 */
	temPresencaPendente: boolean;
}

const TTL_SECONDS = 60;

// v2: inclui `temPresencaPendente` — bump evita servir JSON antigo sem o campo.
const chave = (policialId: number) => chaveEdge(`gise-papel/v2/${policialId}`);

/**
 * Lê o papel GISE do policial. Em miss, consulta o D1 (2 queries em paralelo)
 * e popula o cache.
 */
export async function lerPapelGise(db: Database, policialId: number): Promise<PapelGise> {
	const hit = await lerJsonEdge<PapelGise>(chave(policialId));
	if (hit) return hit;

	const [isSupervisor, isMembro, isSupervisao, temHistorico, temPresencaPendente] =
		await Promise.all([
			isSupervisorGiseAtiva(db, policialId),
			isMembroGiseAtiva(db, policialId),
			isSupervisaoGiseAtiva(db, policialId),
			temGiseHistorico(db, policialId),
			temPresencaGisePendente(db, policialId)
		]);

	const papel: PapelGise = {
		isSupervisor,
		isMembro,
		isSupervisao,
		temHistorico,
		temPresencaPendente
	};

	await gravarJsonEdge(chave(policialId), papel, TTL_SECONDS);

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
	await invalidarEdge(chave(policialId));
}

/** Invalida o cache para vários policiais de uma vez (best-effort). */
export async function invalidarPapelGiseMultiplos(
	policialIds: ReadonlyArray<number | null | undefined>
): Promise<void> {
	const ids = policialIds.filter((id): id is number => typeof id === 'number');
	await invalidarEdgeMultiplos(ids.map(chave));
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
