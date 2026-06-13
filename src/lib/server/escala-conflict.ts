/**
 * Verificação global de choque de horário entre TODAS as escalas
 * (plantão, expediente, FDS e GISE) para impedir que o mesmo policial
 * seja escalado no mesmo dia e horário em dois locais.
 */
import { and, eq, inArray, ne, or } from 'drizzle-orm';
import { seOverlapam } from '$lib/gise/gise-horarios';
import type { Database } from '$lib/db';
import {
	escalaPoliciais,
	escalas as escalasTable,
	giseEscalas,
	giseMembros,
	giseEquipes,
	giseSeccionais
} from '$lib/server/schema';

function normalizarHora(h: string | null | undefined): string {
	if (!h) return '08:00';
	return h.includes(':') ? h : `${String(h).padStart(2, '0')}:00`;
}

/**
 * Verifica conflito apenas nas escalas não-GISE (`escala_policiais`).
 * Utilizado internamente pelas funções GISE para completar a checagem cruzada.
 */
export async function verificarConflitoEscalasNaoGise(
	db: Database,
	policialId: number,
	dataPlantao: string,
	horaEntrada: string,
	horaSaida: string,
	excludeEscalaId: number = -1
): Promise<{ ok: boolean; motivo?: string }> {
	const he = normalizarHora(horaEntrada);
	const hs = normalizarHora(horaSaida);

	const conflitos = await db
		.select({
			titulo: escalasTable.titulo,
			ep_he: escalaPoliciais.hora_entrada,
			ep_hs: escalaPoliciais.hora_saida,
			esc_he: escalasTable.hora_entrada,
			esc_hs: escalasTable.hora_saida
		})
		.from(escalaPoliciais)
		.innerJoin(escalasTable, eq(escalaPoliciais.escala_id, escalasTable.id))
		.where(
			and(
				eq(escalaPoliciais.policial_id, policialId),
				eq(escalaPoliciais.data_plantao, dataPlantao),
				ne(escalaPoliciais.escala_id, excludeEscalaId)
			)
		)
		.all();

	for (const c of conflitos) {
		const eHe = normalizarHora(c.ep_he || c.esc_he);
		const eHs = normalizarHora(c.ep_hs || c.esc_hs);
		if (seOverlapam(he, hs, eHe, eHs)) {
			return {
				ok: false,
				motivo: `Policial já escalado em "${c.titulo}" neste dia no horário ${eHe}–${eHs}`
			};
		}
	}

	return { ok: true };
}

/**
 * Verifica conflito global (escala_policiais + GISE) para uma única data.
 * Usar em `adicionar` e `editar`.
 */
export async function verificarConflitoGlobal(
	db: Database,
	policialId: number,
	dataPlantao: string,
	horaEntrada: string,
	horaSaida: string,
	excludeEscalaId: number
): Promise<{ ok: boolean; motivo?: string }> {
	// 1. Escalas não-GISE
	const naoGise = await verificarConflitoEscalasNaoGise(
		db,
		policialId,
		dataPlantao,
		horaEntrada,
		horaSaida,
		excludeEscalaId
	);
	if (!naoGise.ok) return naoGise;

	// 2. GISE (membro + supervisor/assessor/SEINT)
	const he = normalizarHora(horaEntrada);
	const hs = normalizarHora(horaSaida);

	const [membrosGise, supervisoresGise] = await Promise.all([
		db
			.select({
				gise_he: giseEscalas.hora_entrada,
				gise_hs: giseEscalas.hora_saida,
				sec_he: giseSeccionais.hora_entrada,
				sec_hs: giseSeccionais.hora_saida,
				eq_he: giseEquipes.hora_entrada,
				eq_hs: giseEquipes.hora_saida
			})
			.from(giseMembros)
			.innerJoin(giseEquipes, eq(giseMembros.equipe_id, giseEquipes.id))
			.innerJoin(giseSeccionais, eq(giseEquipes.gise_seccional_id, giseSeccionais.id))
			.innerJoin(giseEscalas, eq(giseSeccionais.gise_id, giseEscalas.id))
			.where(
				and(
					eq(giseMembros.policial_id, policialId),
					ne(giseEscalas.status, 'finalizada'),
					eq(giseEscalas.data_inicio, dataPlantao)
				)
			)
			.all(),
		db
			.select({ hora_entrada: giseEscalas.hora_entrada, hora_saida: giseEscalas.hora_saida })
			.from(giseEscalas)
			.where(
				and(
					or(
						eq(giseEscalas.supervisor_id, policialId),
						eq(giseEscalas.assessor_id, policialId),
						eq(giseEscalas.seint1_id, policialId),
						eq(giseEscalas.seint2_id, policialId)
					),
					ne(giseEscalas.status, 'finalizada'),
					eq(giseEscalas.data_inicio, dataPlantao)
				)
			)
			.all()
	]);

	for (const g of membrosGise) {
		const eHe = g.eq_he ?? g.sec_he ?? g.gise_he;
		const eHs = g.eq_hs ?? g.sec_hs ?? g.gise_hs;
		if (eHe && eHs && seOverlapam(he, hs, eHe, eHs)) {
			return {
				ok: false,
				motivo: `Policial já escalado em GISE neste dia no horário ${eHe}–${eHs}`
			};
		}
	}

	for (const g of supervisoresGise) {
		if (seOverlapam(he, hs, g.hora_entrada, g.hora_saida)) {
			return {
				ok: false,
				motivo: `Policial já escalado como supervisor/SEINT em GISE neste dia no horário ${g.hora_entrada}–${g.hora_saida}`
			};
		}
	}

	return { ok: true };
}

/**
 * Verifica conflito global para um conjunto de datas de uma vez só (batch).
 * Usa 2 queries em vez de N×2. Retorna um Map<data, motivo> para as datas com conflito.
 */
export async function verificarConflitoGlobalBatch(
	db: Database,
	policialId: number,
	datas: string[],
	horaEntrada: string,
	horaSaida: string,
	excludeEscalaId: number
): Promise<Map<string, string>> {
	if (datas.length === 0) return new Map();

	const he = normalizarHora(horaEntrada);
	const hs = normalizarHora(horaSaida);
	const conflitos = new Map<string, string>();

	// Batch query: escalas não-GISE
	const existentesEscalas = await db
		.select({
			data_plantao: escalaPoliciais.data_plantao,
			titulo: escalasTable.titulo,
			ep_he: escalaPoliciais.hora_entrada,
			ep_hs: escalaPoliciais.hora_saida,
			esc_he: escalasTable.hora_entrada,
			esc_hs: escalasTable.hora_saida
		})
		.from(escalaPoliciais)
		.innerJoin(escalasTable, eq(escalaPoliciais.escala_id, escalasTable.id))
		.where(
			and(
				eq(escalaPoliciais.policial_id, policialId),
				inArray(escalaPoliciais.data_plantao, datas),
				ne(escalaPoliciais.escala_id, excludeEscalaId)
			)
		)
		.all();

	for (const c of existentesEscalas) {
		if (conflitos.has(c.data_plantao)) continue;
		const eHe = normalizarHora(c.ep_he || c.esc_he);
		const eHs = normalizarHora(c.ep_hs || c.esc_hs);
		if (seOverlapam(he, hs, eHe, eHs)) {
			conflitos.set(
				c.data_plantao,
				`Policial já escalado em "${c.titulo}" neste dia no horário ${eHe}–${eHs}`
			);
		}
	}

	// Batch query: GISE membros
	const existentesGiseMembros = await db
		.select({
			data_inicio: giseEscalas.data_inicio,
			gise_he: giseEscalas.hora_entrada,
			gise_hs: giseEscalas.hora_saida,
			sec_he: giseSeccionais.hora_entrada,
			sec_hs: giseSeccionais.hora_saida,
			eq_he: giseEquipes.hora_entrada,
			eq_hs: giseEquipes.hora_saida
		})
		.from(giseMembros)
		.innerJoin(giseEquipes, eq(giseMembros.equipe_id, giseEquipes.id))
		.innerJoin(giseSeccionais, eq(giseEquipes.gise_seccional_id, giseSeccionais.id))
		.innerJoin(giseEscalas, eq(giseSeccionais.gise_id, giseEscalas.id))
		.where(
			and(
				eq(giseMembros.policial_id, policialId),
				ne(giseEscalas.status, 'finalizada'),
				inArray(giseEscalas.data_inicio, datas)
			)
		)
		.all();

	for (const g of existentesGiseMembros) {
		if (conflitos.has(g.data_inicio)) continue;
		const eHe = g.eq_he ?? g.sec_he ?? g.gise_he;
		const eHs = g.eq_hs ?? g.sec_hs ?? g.gise_hs;
		if (eHe && eHs && seOverlapam(he, hs, eHe, eHs)) {
			conflitos.set(
				g.data_inicio,
				`Policial já escalado em GISE neste dia no horário ${eHe}–${eHs}`
			);
		}
	}

	// Batch query: GISE supervisores/SEINT
	const existentesGiseSup = await db
		.select({
			data_inicio: giseEscalas.data_inicio,
			hora_entrada: giseEscalas.hora_entrada,
			hora_saida: giseEscalas.hora_saida
		})
		.from(giseEscalas)
		.where(
			and(
				or(
					eq(giseEscalas.supervisor_id, policialId),
					eq(giseEscalas.assessor_id, policialId),
					eq(giseEscalas.seint1_id, policialId),
					eq(giseEscalas.seint2_id, policialId)
				),
				ne(giseEscalas.status, 'finalizada'),
				inArray(giseEscalas.data_inicio, datas)
			)
		)
		.all();

	for (const g of existentesGiseSup) {
		if (conflitos.has(g.data_inicio)) continue;
		if (seOverlapam(he, hs, g.hora_entrada, g.hora_saida)) {
			conflitos.set(
				g.data_inicio,
				`Policial já escalado como supervisor/SEINT em GISE neste dia no horário ${g.hora_entrada}–${g.hora_saida}`
			);
		}
	}

	return conflitos;
}
