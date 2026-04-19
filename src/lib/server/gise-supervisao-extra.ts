import { and, eq } from 'drizzle-orm';
import { unidades, giseSeccionais } from '$lib/server/schema';
import type { Database } from '$lib/db/core';
import { GISE_SUPERVISAO_EXTRA_UNIDADE_NOME } from '$lib/gise/gise-supervisao-extra';

/**
 * Só cacheia ID encontrado. Nunca cachear `null`: antes o código fazia `cache = null` e
 * `null !== undefined` era true, então todas as chamadas seguintes retornavam null sem
 * reconsultar o banco — migração aplicada depois do start nunca era vista.
 */
let unidadeSupervisaoExtraIdCache: number | undefined;

export async function buscarUnidadeIdSupervisaoExtra(db: Database): Promise<number | null> {
	if (unidadeSupervisaoExtraIdCache !== undefined) {
		return unidadeSupervisaoExtraIdCache;
	}

	let row = await db
		.select({ id: unidades.id })
		.from(unidades)
		.where(eq(unidades.nome, GISE_SUPERVISAO_EXTRA_UNIDADE_NOME))
		.get();

	if (!row?.id) {
		await db
			.insert(unidades)
			.values({
				nome: GISE_SUPERVISAO_EXTRA_UNIDADE_NOME,
				tipo: 'delegacia',
				seccional_id: null,
				cidade: '',
				tem_plantao: false,
				tem_expediente: false,
				tem_fds: false
			})
			.onConflictDoNothing();

		row = await db
			.select({ id: unidades.id })
			.from(unidades)
			.where(eq(unidades.nome, GISE_SUPERVISAO_EXTRA_UNIDADE_NOME))
			.get();
	}

	if (row?.id != null) {
		unidadeSupervisaoExtraIdCache = row.id;
		return row.id;
	}

	return null;
}

export function limparCacheUnidadeSupervisaoExtra() {
	unidadeSupervisaoExtraIdCache = undefined;
}

export async function secIdEhSupervisaoExtra(db: Database, seccionalId: number): Promise<boolean> {
	const sid = await buscarUnidadeIdSupervisaoExtra(db);
	return sid !== null && seccionalId === sid;
}

/** A seccional pertence a esta GISE (tabela `gise_seccionais`) ou é o slot sintético de extra da supervisão. */
export async function giseAutorizaSeccionalRelatorioExtra(
	db: Database,
	giseId: number,
	seccionalId: number
): Promise<boolean> {
	if (await secIdEhSupervisaoExtra(db, seccionalId)) return true;
	const row = await db
		.select({ id: giseSeccionais.id })
		.from(giseSeccionais)
		.where(and(eq(giseSeccionais.gise_id, giseId), eq(giseSeccionais.seccional_id, seccionalId)))
		.get();
	return !!row;
}
