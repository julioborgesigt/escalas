import { eq, and, or, ne, isNotNull, desc, asc, inArray, sql } from 'drizzle-orm';
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

export async function atualizarGiseEquipe(
	db: Database,
	id: number,
	slots_dpc?: number,
	slots_oip?: number,
	customHours?: Partial<{ hora_entrada: string | null; hora_saida: string | null }>
) {
	const data: Record<string, unknown> = {};
	if (slots_dpc !== undefined) data.slots_dpc = slots_dpc;
	if (slots_oip !== undefined) data.slots_oip = slots_oip;
	if (customHours?.hora_entrada !== undefined) data.hora_entrada = customHours.hora_entrada;
	if (customHours?.hora_saida !== undefined) data.hora_saida = customHours.hora_saida;
	return db.update(giseEquipes).set(data).where(eq(giseEquipes.id, id));
}

export async function excluirGiseEquipe(db: Database, id: number) {
	return db.delete(giseEquipes).where(eq(giseEquipes.id, id));
}

export async function criarGiseEquipe(
	db: Database,
	giseSeccionalId: number,
	tipo: 'operacional' | 'seint',
	slots_dpc: number,
	slots_oip: number,
	giseUnidadeId?: number | null
) {
	const result = await db
		.insert(giseEquipes)
		.values({
			gise_seccional_id: giseSeccionalId,
			gise_unidade_id: giseUnidadeId ?? null,
			tipo,
			slots_dpc,
			slots_oip
		})
		.returning({ id: giseEquipes.id });
	return result[0].id;
}
export async function verificarSlotEquipe(
	db: Database,
	equipeId: number,
	policialId: number
): Promise<{ ok: boolean; motivo?: string }> {
	// Parallelize independent queries
	const [equipe, policial] = await Promise.all([
		db.select().from(giseEquipes).where(eq(giseEquipes.id, equipeId)).get(),
		db.select({ cargo: policiais.cargo }).from(policiais).where(eq(policiais.id, policialId)).get()
	]);

	if (!equipe) return { ok: false, motivo: 'Equipe não encontrada' };
	if (!policial) return { ok: false, motivo: 'Policial não encontrado' };

	const membrosEquipe = await db
		.select({ policial_id: giseMembros.policial_id })
		.from(giseMembros)
		.innerJoin(policiais, eq(giseMembros.policial_id, policiais.id))
		.where(and(eq(giseMembros.equipe_id, equipeId), eq(policiais.cargo, policial.cargo)));

	const ocupados = membrosEquipe.length;
	const limite = policial.cargo === 'DPC' ? equipe.slots_dpc : equipe.slots_oip;
	if (ocupados >= limite) {
		return {
			ok: false,
			motivo: `Vagas de ${policial.cargo} esgotadas nesta equipe (limite: ${limite})`
		};
	}

	return { ok: true };
}
