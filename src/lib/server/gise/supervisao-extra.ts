import { and, asc, eq } from 'drizzle-orm';
import { unidades, giseSeccionais } from '$lib/server/schema';
import type { Database } from '$lib/db/core';
import {
	GISE_SUPERVISAO_EXTRA_DEPARTAMENTO_NOME,
	GISE_SUPERVISAO_EXTRA_UNIDADE_NOME
} from '$lib/gise/supervisao-extra';

/**
 * `undefined` = ainda não consultado; `number` = ID a usar; `null` = nenhum departamento/legado
 * no banco (evita reconsultar a cada request após primeira resolução).
 */
let unidadeSupervisaoExtraIdCache: number | null | undefined;
/** IDs aceitos como “extra do quadro de supervisão” (departamento atual + unidade legada). */
let idsSupervisaoExtraCache: Set<number> | undefined;

async function buscarIdDepartamentoSupervisaoExtra(db: Database): Promise<number | null> {
	const preferencial = await db
		.select({ id: unidades.id })
		.from(unidades)
		.where(
			and(
				eq(unidades.nome, GISE_SUPERVISAO_EXTRA_DEPARTAMENTO_NOME),
				eq(unidades.tipo, 'departamento')
			)
		)
		.get();
	if (preferencial?.id != null) return preferencial.id;

	// Em bases antigas ou sincronizadas com nomes divergentes, se houver um único
	// departamento cadastrado ele é, por definição, o pai do relatório extra.
	const departamentos = await db
		.select({ id: unidades.id })
		.from(unidades)
		.where(eq(unidades.tipo, 'departamento'))
		.orderBy(asc(unidades.nome))
		.all();
	return departamentos.length === 1 ? departamentos[0].id : null;
}

async function buscarIdUnidadeLegadaSupervisaoExtra(db: Database): Promise<number | null> {
	const row = await db
		.select({ id: unidades.id })
		.from(unidades)
		.where(eq(unidades.nome, GISE_SUPERVISAO_EXTRA_UNIDADE_NOME))
		.get();
	return row?.id ?? null;
}

/**
 * ID usado em fluxos novos (assinatura, download, UI): preferencialmente o departamento pai.
 * Se não achar pelo nome configurado, aceita o único departamento existente na base.
 * Se ainda assim não existir departamento, usa a unidade sintética legada, se houver.
 */
export async function buscarUnidadeIdSupervisaoExtra(db: Database): Promise<number | null> {
	if (unidadeSupervisaoExtraIdCache !== undefined) {
		return unidadeSupervisaoExtraIdCache;
	}

	const deptId = await buscarIdDepartamentoSupervisaoExtra(db);
	const legadoId = deptId == null ? await buscarIdUnidadeLegadaSupervisaoExtra(db) : null;

	const resolved = deptId ?? legadoId;
	unidadeSupervisaoExtraIdCache = resolved;
	return resolved;
}

async function idsSupervisaoExtraReconhecidos(db: Database): Promise<Set<number>> {
	if (idsSupervisaoExtraCache) return idsSupervisaoExtraCache;
	const s = new Set<number>();
	const deptId = await buscarIdDepartamentoSupervisaoExtra(db);
	if (deptId != null) s.add(deptId);
	const legadoId = await buscarIdUnidadeLegadaSupervisaoExtra(db);
	if (legadoId != null) s.add(legadoId);
	idsSupervisaoExtraCache = s;
	return s;
}

/** Autoriza `seccionalId` como slot de relatório de extra do quadro de supervisão (dept ou legado). */
export async function secIdEhSupervisaoExtra(db: Database, seccionalId: number): Promise<boolean> {
	return (await idsSupervisaoExtraReconhecidos(db)).has(seccionalId);
}

/** A seccional pertence a esta GISE (tabela `gise_seccionais`) ou é o slot de extra da supervisão. */
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
