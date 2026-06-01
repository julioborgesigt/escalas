import { eq, and, ne, isNotNull, desc, inArray, sql } from 'drizzle-orm';
import {
	giseEscalas,
	giseSeccionais,
	giseEquipes,
	giseSeccionalUnidades,
	giseDocumentos,
	giseAssinaturasRelatorios,
	gisePresencas,
	unidades
} from '../../server/schema';
import type * as schema from '../../server/schema';
import type { Database } from '../core';
import { buscarVagasPadraoEquipesGise } from './vagas-padrao';

export async function buscarGiseEscala(
	db: Database,
	id: number
): Promise<schema.GiseEscala | undefined> {
	return db.select().from(giseEscalas).where(eq(giseEscalas.id, id)).get();
}

export async function buscarGiseAtiva(db: Database) {
	const ativa = await db
		.select()
		.from(giseEscalas)
		.where(ne(giseEscalas.status, 'finalizada'))
		.orderBy(desc(giseEscalas.data_inicio))
		.get();

	if (!ativa) return undefined;

	const [temSaida, totalSecRow, assExtraRow] = await Promise.all([
		db
			.select({ id: gisePresencas.id })
			.from(gisePresencas)
			.where(and(eq(gisePresencas.gise_id, ativa.id), isNotNull(gisePresencas.saida_timestamp)))
			.limit(1)
			.get(),
		db
			.select({ count: sql<number>`count(*)` })
			.from(giseSeccionais)
			.where(eq(giseSeccionais.gise_id, ativa.id))
			.get(),
		db
			.select({ count: sql<number>`count(*)` })
			.from(giseAssinaturasRelatorios)
			.where(
				and(
					eq(giseAssinaturasRelatorios.gise_id, ativa.id),
					eq(giseAssinaturasRelatorios.tipo, 'extraordinario')
				)
			)
			.get()
	]);

	return {
		...ativa,
		temSaidaConfirmada: !!temSaida,
		totalSeccionais: totalSecRow?.count ?? 0,
		assinaturasRelatorioExtra: assExtraRow?.count ?? 0
	};
}

export async function criarGiseEscala(
	db: Database,
	dataInicio: string,
	horaEntrada: string,
	horaSaida: string,
	statusInicial: 'em_definicao_supervisor' | 'em_preenchimento' = 'em_definicao_supervisor',
	feriado = false
): Promise<number> {
	const result = await db
		.insert(giseEscalas)
		.values({
			data_inicio: dataInicio,
			feriado: feriado ? 1 : 0,
			hora_entrada: horaEntrada,
			hora_saida: horaSaida,
			status: statusInicial
		})
		.returning({ id: giseEscalas.id });
	return result[0].id;
}

export async function atualizarGiseEscala(
	db: Database,
	id: number,
	data: Partial<{
		data_inicio: string;
		hora_entrada: string;
		hora_saida: string;
		status:
		| 'em_definicao_supervisor'
		| 'em_preenchimento'
		| 'aguardando_assinatura'
		| 'em_andamento'
		| 'aguardando_relatorios'
		| 'aguardando_assinatura_relat'
		| 'pronta_para_finalizar'
		| 'finalizada';
		supervisor_id: number | null;
		assessor_id: number | null;
		seint1_id: number | null;
		seint2_id: number | null;
		assessor_email_notificacao: string | null;
		breve_relatorio_titulo: string | null;
		breve_relatorio_texto_seccional: string | null;
		breve_relatorio_texto_supervisao: string | null;
		planilha_base_equipe_alimentada_em: string | null;
	}>
) {
	return db.update(giseEscalas).set(data).where(eq(giseEscalas.id, id));
}

export async function reabrirGiseEscala(db: Database, giseId: number) {
	// Todas as operações são independentes — executa em paralelo
	await Promise.all([
		db.delete(giseDocumentos).where(eq(giseDocumentos.gise_id, giseId)),
		db.delete(giseAssinaturasRelatorios).where(eq(giseAssinaturasRelatorios.gise_id, giseId)),
		db.delete(gisePresencas).where(eq(gisePresencas.gise_id, giseId)),
		atualizarGiseEscala(db, giseId, {
			status: 'em_preenchimento',
			planilha_base_equipe_alimentada_em: null
		})
	]);
}

export async function clonarGiseParaData(
	db: Database,
	giseId: number,
	novaData: string,
	modo: 'clonada' | 'completa' = 'clonada',
	horaEntrada?: string,
	horaSaida?: string,
	feriado?: boolean
): Promise<number> {
	const gise = await db.select().from(giseEscalas).where(eq(giseEscalas.id, giseId)).get();
	if (!gise) throw new Error('GISE não encontrada');

	const feriadoNovo = feriado ?? !!gise.feriado;
	const novoId = await criarGiseEscala(
		db,
		novaData,
		horaEntrada ?? gise.hora_entrada,
		horaSaida ?? gise.hora_saida,
		'em_definicao_supervisor',
		feriadoNovo
	);

	const secsParaClonar: { seccional_id: number; id?: number }[] =
		modo === 'clonada'
			? await db.select().from(giseSeccionais).where(eq(giseSeccionais.gise_id, giseId)).all()
			: (await db.select().from(unidades).where(eq(unidades.tipo, 'seccional')).all()).map(
					(s) => ({ seccional_id: s.id })
				);

	if (secsParaClonar.length === 0) return novoId;

	// Insert seccionais sequencialmente (D1 não suporta transações aninhadas com batch)
	const secsInsert: { id: number; seccional_id: number }[] = [];
	for (const sec of secsParaClonar) {
		const [inserted] = await db.insert(giseSeccionais).values({
			gise_id: novoId,
			seccional_id: sec.seccional_id,
			unidade_operacional_id: null,
			status: 'pendente' as const
		}).returning({ id: giseSeccionais.id, seccional_id: giseSeccionais.seccional_id });
		secsInsert.push(inserted);
	}

	// Build map: old seccional id -> new seccional id
	const secIdMap = new Map<number, number>();
	if (modo === 'clonada') {
		for (let i = 0; i < secsParaClonar.length; i++) {
			if (secsParaClonar[i].id) {
				secIdMap.set(secsParaClonar[i].id, secsInsert[i].id);
			}
		}
	}

	// Clonar slots e equipes (modo clonada) ou criar slot padrão (modo completa)
	if (modo === 'clonada') {
		const oldSecIds = secsParaClonar.filter((s) => s.id).map((s) => s.id as number);
		if (oldSecIds.length > 0) {
			// Clona slots de unidade
			const slotsOriginais = await db
				.select()
				.from(giseSeccionalUnidades)
				.where(inArray(giseSeccionalUnidades.gise_seccional_id, oldSecIds));

			const slotIdMap = new Map<number, number>(); // old slot id -> new slot id

			for (const slot of slotsOriginais) {
				const newSecId = secIdMap.get(slot.gise_seccional_id);
				if (newSecId) {
					const [newSlot] = await db.insert(giseSeccionalUnidades).values({
						gise_seccional_id: newSecId,
						unidade_id: slot.unidade_id
					}).returning({ id: giseSeccionalUnidades.id });
					slotIdMap.set(slot.id, newSlot.id);
				}
			}

			// Clona equipes com gise_unidade_id remapeado
			const equipesOriginais = await db
				.select()
				.from(giseEquipes)
				.where(inArray(giseEquipes.gise_seccional_id, oldSecIds));

			for (const eq_ of equipesOriginais) {
				const newSecId = secIdMap.get(eq_.gise_seccional_id);
				if (newSecId) {
					const newUnidadeId = eq_.gise_unidade_id !== null
						? (slotIdMap.get(eq_.gise_unidade_id) ?? null)
						: null;
					await db.insert(giseEquipes).values({
						gise_seccional_id: newSecId,
						gise_unidade_id: newUnidadeId,
						tipo: eq_.tipo,
						slots_dpc: eq_.slots_dpc,
						slots_oip: eq_.slots_oip
					});
				}
			}
		}
	}

	// Criar slot + equipe padrão para seccionais sem slots (modo completa ou fallback)
	const novasSecIds = secsInsert.map((s) => s.id);
	if (novasSecIds.length > 0) {
		const slotsExistentes = await db
			.select({ gise_seccional_id: giseSeccionalUnidades.gise_seccional_id })
			.from(giseSeccionalUnidades)
			.where(inArray(giseSeccionalUnidades.gise_seccional_id, novasSecIds));

		const secIdsSemSlot = novasSecIds.filter(
			(id) => !slotsExistentes.some((s) => s.gise_seccional_id === id)
		);

		const v = await buscarVagasPadraoEquipesGise(db);
		for (const secId of secIdsSemSlot) {
			const [slot] = await db.insert(giseSeccionalUnidades).values({
				gise_seccional_id: secId,
				unidade_id: null
			}).returning({ id: giseSeccionalUnidades.id });

			await db.insert(giseEquipes).values([
				{
					gise_seccional_id: secId,
					gise_unidade_id: slot.id,
					tipo: 'operacional' as const,
					slots_dpc: v.operacional.dpc,
					slots_oip: v.operacional.oip
				},
				{
					gise_seccional_id: secId,
					gise_unidade_id: slot.id,
					tipo: 'seint' as const,
					slots_dpc: v.seint.dpc,
					slots_oip: v.seint.oip
				}
			]);
		}
	}

	return novoId;
}
