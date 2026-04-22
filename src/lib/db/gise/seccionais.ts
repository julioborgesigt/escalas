import { eq, and, or, ne, isNotNull, desc, asc, inArray, sql } from 'drizzle-orm';
import { buscarVagasPadraoEquipesGise } from './vagas-padrao';
import {
	giseEscalas,
	giseSeccionais,
	giseEquipes,
	giseMembros,
	giseDocumentos,
	gisePresencas,
	giseModeloFormulario,
	giseRespostasFormulario,
	giseAssinaturasRelatorios,
	giseSeccionalUnidades,
	policiais,
	unidades
} from '../../server/schema';
import type * as schema from '../../server/schema';
import type { Database } from '../core';

export async function upsertGiseSeccional(
	db: Database,
	giseId: number,
	seccionalId: number,
	unidadeOperacionalId?: number | null
): Promise<number> {
	const existing = await db
		.select({ id: giseSeccionais.id })
		.from(giseSeccionais)
		.where(and(eq(giseSeccionais.gise_id, giseId), eq(giseSeccionais.seccional_id, seccionalId)))
		.get();

	if (existing) {
		if (unidadeOperacionalId !== undefined) {
			await db
				.update(giseSeccionais)
				.set({ unidade_operacional_id: unidadeOperacionalId })
				.where(eq(giseSeccionais.id, existing.id));
		}
		return existing.id;
	}

	const result = await db
		.insert(giseSeccionais)
		.values({
			gise_id: giseId,
			seccional_id: seccionalId,
			unidade_operacional_id: unidadeOperacionalId ?? null
		})
		.returning({ id: giseSeccionais.id });

	const secId = result[0].id;
	const v = await buscarVagasPadraoEquipesGise(db);

	// Cria 1 slot de unidade em branco (sem unidade definida) com equipe padrão
	const [slotResult] = await db
		.insert(giseSeccionalUnidades)
		.values({ gise_seccional_id: secId, unidade_id: null })
		.returning({ id: giseSeccionalUnidades.id });
	if (slotResult) {
		await db.insert(giseEquipes).values([
			{
				gise_seccional_id: secId,
				gise_unidade_id: slotResult.id,
				tipo: 'operacional',
				slots_dpc: v.operacional.dpc,
				slots_oip: v.operacional.oip
			},
			{
				gise_seccional_id: secId,
				gise_unidade_id: slotResult.id,
				tipo: 'seint',
				slots_dpc: v.seint.dpc,
				slots_oip: v.seint.oip
			}
		]);
	}

	return secId;
}

export async function atualizarGiseSeccional(
	db: Database,
	id: number,
	data: Partial<{
		unidade_operacional_id: number | null;
		status: 'pendente' | 'preenchida' | 'retificada' | 'preenchida_retificada';
		hora_entrada: string | null;
		hora_saida: string | null;
	}>
) {
	return db.update(giseSeccionais).set(data).where(eq(giseSeccionais.id, id));
}

export async function excluirGiseSeccional(db: Database, id: number) {
	return db.delete(giseSeccionais).where(eq(giseSeccionais.id, id));
}
export async function buscarGiseSeccionalMembros(db: Database, giseId: number, seccionalId: number) {
	return db
		.select({
			id: giseMembros.id,
			equipe_id: giseMembros.equipe_id,
			policial_id: giseMembros.policial_id,
			policial_nome: policiais.nome,
			policial_cpf: policiais.cpf
		})
		.from(giseMembros)
		.innerJoin(policiais, eq(giseMembros.policial_id, policiais.id))
		.innerJoin(giseEquipes, eq(giseMembros.equipe_id, giseEquipes.id))
		.innerJoin(giseSeccionais, eq(giseEquipes.gise_seccional_id, giseSeccionais.id))
		.where(and(eq(giseSeccionais.gise_id, giseId), eq(giseSeccionais.seccional_id, seccionalId)))
		.all();
}

/**
 * Revoga as assinaturas de policiais e relatórios de uma seccional específica.
 * Usado quando há alteração na escala que invalida as assinaturas anteriores.
 */
export async function revogarAssinaturasSeccional(db: Database, giseId: number, seccionalId: number) {
	// 1. Limpar as assinaturas dos relatórios de extra/produtividade do supervisor desta seccional
	await db.delete(giseAssinaturasRelatorios)
		.where(and(
			eq(giseAssinaturasRelatorios.gise_id, giseId),
			eq(giseAssinaturasRelatorios.seccional_id, seccionalId)
		));

	// 2. Localizar todos os policiais vinculados a esta seccional na GISE
	const membros = await buscarGiseSeccionalMembros(db, giseId, seccionalId);
	const policialIds = membros.map(m => m.policial_id);

	if (policialIds.length > 0) {
		// 3. Limpar as assinaturas de entrada/saída (presenças) desses policiais na GISE
		await db.delete(gisePresencas)
			.where(and(
				eq(gisePresencas.gise_id, giseId),
				inArray(gisePresencas.policial_id, policialIds)
			));
	}

	// 4. Se a escala do GISE já estiver assinada, revogar também a assinatura principal
	// (Pois a integridade do documento final foi alterada)
	// giseDocumentos tem gise_id como PK/Unique
	await db.delete(giseDocumentos).where(eq(giseDocumentos.gise_id, giseId));

	// 5. Garantir que o status da escala volte para 'em_preenchimento' para forçar novas assinaturas
	await db.update(giseEscalas)
		.set({ status: 'em_preenchimento' })
		.where(and(
			eq(giseEscalas.id, giseId),
			ne(giseEscalas.status, 'finalizada') // Não reabrir se já estiver finalizada (isso é manual)
		));
}
export async function adicionarGiseSeccionalUnidade(
	db: Database,
	giseSeccionalId: number,
	unidadeId: number | null
): Promise<number> {
	const v = await buscarVagasPadraoEquipesGise(db);
	const [result] = await db
		.insert(giseSeccionalUnidades)
		.values({ gise_seccional_id: giseSeccionalId, unidade_id: unidadeId })
		.returning({ id: giseSeccionalUnidades.id });

	// Equipes padrão vinculadas ao slot
	await db.insert(giseEquipes).values([
		{
			gise_seccional_id: giseSeccionalId,
			gise_unidade_id: result.id,
			tipo: 'operacional',
			slots_dpc: v.operacional.dpc,
			slots_oip: v.operacional.oip
		},
		{
			gise_seccional_id: giseSeccionalId,
			gise_unidade_id: result.id,
			tipo: 'seint',
			slots_dpc: v.seint.dpc,
			slots_oip: v.seint.oip
		}
	]);

	return result.id;
}

/**
 * Atualiza a unidade de um slot (usado pelo Adm Seccional para preencher um slot em branco).
 */
export async function atualizarGiseSeccionalUnidade(
	db: Database,
	slotId: number,
	unidadeId: number
) {
	return db
		.update(giseSeccionalUnidades)
		.set({ unidade_id: unidadeId })
		.where(eq(giseSeccionalUnidades.id, slotId));
}

export async function removerGiseSeccionalUnidade(
	db: Database,
	giseSeccionalUnidadeId: number
) {
	return db
		.delete(giseSeccionalUnidades)
		.where(eq(giseSeccionalUnidades.id, giseSeccionalUnidadeId));
}
