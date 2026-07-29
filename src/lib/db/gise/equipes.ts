/**
 * Equipes de uma seccional na GISE.
 *
 * Cada equipe reserva um número de vagas por cargo (`slots_dpc`/`slots_oip`) e
 * pode ter horário próprio; membros entram por `membros.ts`, respeitando essas
 * vagas.
 */
import { eq, and } from 'drizzle-orm';
import { giseEquipes, giseMembros, policiais } from '../../server/schema';
import type { Database } from '../core';

/**
 * Atualização parcial: cada argumento só é gravado se vier definido, para que
 * salvar horário não zere as vagas (e vice-versa) — as duas telas são separadas.
 */
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

/** Remove a equipe; os membros caem junto pela cascata do schema. */
export async function excluirGiseEquipe(db: Database, id: number) {
	return db.delete(giseEquipes).where(eq(giseEquipes.id, id));
}

/** Cria a equipe e devolve o id gerado. `giseUnidadeId` nulo = slot em aberto. */
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
/**
 * Ainda há vaga nesta equipe para o CARGO do policial?
 *
 * As vagas são contadas por cargo: um OIP não ocupa vaga de DPC. O limite é o
 * `slots_*` da equipe e a contagem considera só os membros do mesmo cargo.
 */
export async function verificarSlotEquipe(
	db: Database,
	equipeId: number,
	policialId: number
): Promise<{ ok: boolean; motivo?: string }> {
	// Consultas independentes em paralelo (o cargo do policial define qual limite
	// consultar, mas nenhuma depende do resultado da outra).
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
