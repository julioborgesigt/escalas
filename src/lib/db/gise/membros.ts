import { eq, and, or, ne } from 'drizzle-orm';
import { verificarConflitoEscalasNaoGise } from '../../server/escala-conflict';
import {
	giseEscalas,
	giseSeccionais,
	giseEquipes,
	giseMembros,
	unidades
} from '../../server/schema';
import type { Database } from '../core';
import { seOverlapam } from '../../gise/gise-horarios';

export async function adicionarGiseMembro(db: Database, equipeId: number, policialId: number) {
	return db.insert(giseMembros).values({ equipe_id: equipeId, policial_id: policialId });
}

export async function removerGiseMembro(db: Database, id: number) {
	return db.delete(giseMembros).where(eq(giseMembros.id, id));
}
export async function verificarConflitoMembroGise(
	db: Database,
	giseId: number,
	policialId: number
): Promise<{ ok: boolean; motivo?: string }> {
	const membros = await db
		.select({ id: giseMembros.id, equipe_id: giseMembros.equipe_id, seccional_nome: unidades.nome })
		.from(giseMembros)
		.innerJoin(giseEquipes, eq(giseMembros.equipe_id, giseEquipes.id))
		.innerJoin(giseSeccionais, eq(giseEquipes.gise_seccional_id, giseSeccionais.id))
		.innerJoin(unidades, eq(giseSeccionais.seccional_id, unidades.id))
		.where(and(eq(giseMembros.policial_id, policialId), eq(giseSeccionais.gise_id, giseId)));

	if (membros.length > 0) {
		return {
			ok: false,
			motivo: `Policial já escalado nesta GISE na seccional ${membros[0].seccional_nome}`
		};
	}

	return { ok: true };
}

/**
 * Verifica se o policial tem choque de horário em outra GISE (como membro)
 * no mesmo dia da equipe alvo.
 */
export async function verificarConflitoHorarioPolicial(
	db: Database,
	equipeId: number,
	policialId: number
): Promise<{ ok: boolean; motivo?: string }> {
	const target = await db
		.select({
			gise_id: giseEscalas.id,
			data_inicio: giseEscalas.data_inicio,
			gise_hora_entrada: giseEscalas.hora_entrada,
			gise_hora_saida: giseEscalas.hora_saida,
			sec_hora_entrada: giseSeccionais.hora_entrada,
			sec_hora_saida: giseSeccionais.hora_saida,
			eq_hora_entrada: giseEquipes.hora_entrada,
			eq_hora_saida: giseEquipes.hora_saida
		})
		.from(giseEquipes)
		.innerJoin(giseSeccionais, eq(giseEquipes.gise_seccional_id, giseSeccionais.id))
		.innerJoin(giseEscalas, eq(giseSeccionais.gise_id, giseEscalas.id))
		.where(eq(giseEquipes.id, equipeId))
		.get();

	if (!target) return { ok: false, motivo: 'Equipe não encontrada' };

	const novaEntrada = target.eq_hora_entrada ?? target.sec_hora_entrada ?? target.gise_hora_entrada;
	const novaSaida = target.eq_hora_saida ?? target.sec_hora_saida ?? target.gise_hora_saida;

	// Verifica conflito com escalas não-GISE (plantão/expediente/fds)
	const naoGiseCheck = await verificarConflitoEscalasNaoGise(
		db,
		policialId,
		target.data_inicio,
		novaEntrada,
		novaSaida
	);
	if (!naoGiseCheck.ok) return naoGiseCheck;

	const [membrosExistentes, supervisorGises] = await Promise.all([
		db
			.select({
				gise_hora_entrada: giseEscalas.hora_entrada,
				gise_hora_saida: giseEscalas.hora_saida,
				sec_hora_entrada: giseSeccionais.hora_entrada,
				sec_hora_saida: giseSeccionais.hora_saida,
				eq_hora_entrada: giseEquipes.hora_entrada,
				eq_hora_saida: giseEquipes.hora_saida
			})
			.from(giseMembros)
			.innerJoin(giseEquipes, eq(giseMembros.equipe_id, giseEquipes.id))
			.innerJoin(giseSeccionais, eq(giseEquipes.gise_seccional_id, giseSeccionais.id))
			.innerJoin(giseEscalas, eq(giseSeccionais.gise_id, giseEscalas.id))
			.where(
				and(
					eq(giseMembros.policial_id, policialId),
					ne(giseEscalas.id, target.gise_id),
					ne(giseEscalas.status, 'finalizada'),
					eq(giseEscalas.data_inicio, target.data_inicio)
				)
			)
			.all(),
		db
			.select({
				gise_hora_entrada: giseEscalas.hora_entrada,
				gise_hora_saida: giseEscalas.hora_saida
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
					ne(giseEscalas.id, target.gise_id),
					ne(giseEscalas.status, 'finalizada'),
					eq(giseEscalas.data_inicio, target.data_inicio)
				)
			)
			.all()
	]);

	for (const e of membrosExistentes) {
		const existenteEntrada = e.eq_hora_entrada ?? e.sec_hora_entrada ?? e.gise_hora_entrada;
		const existenteSaida = e.eq_hora_saida ?? e.sec_hora_saida ?? e.gise_hora_saida;
		if (seOverlapam(novaEntrada, novaSaida, existenteEntrada, existenteSaida)) {
			return {
				ok: false,
				motivo: `Policial já escalado em outra GISE neste dia com horário conflitante (${existenteEntrada}–${existenteSaida})`
			};
		}
	}

	for (const g of supervisorGises) {
		if (seOverlapam(novaEntrada, novaSaida, g.gise_hora_entrada, g.gise_hora_saida)) {
			return {
				ok: false,
				motivo: `Policial já escalado como supervisor/SEINT em outra GISE neste dia com horário conflitante (${g.gise_hora_entrada}–${g.gise_hora_saida})`
			};
		}
	}

	return { ok: true };
}

/**
 * Verifica se o policial tem choque de horário ao ser atribuído como supervisor/assessor/seint
 * em uma GISE — verifica conflito com outras GISEs ativas no mesmo dia.
 */
export async function verificarConflitoHorarioPorGise(
	db: Database,
	giseId: number,
	policialId: number
): Promise<{ ok: boolean; motivo?: string }> {
	const gise = await db
		.select({
			data_inicio: giseEscalas.data_inicio,
			hora_entrada: giseEscalas.hora_entrada,
			hora_saida: giseEscalas.hora_saida
		})
		.from(giseEscalas)
		.where(eq(giseEscalas.id, giseId))
		.get();

	if (!gise) return { ok: false, motivo: 'GISE não encontrada' };

	// Verifica conflito com escalas não-GISE (plantão/expediente/fds)
	const naoGiseCheck = await verificarConflitoEscalasNaoGise(
		db,
		policialId,
		gise.data_inicio,
		gise.hora_entrada,
		gise.hora_saida
	);
	if (!naoGiseCheck.ok) return naoGiseCheck;

	const [membrosExistentes, supervisorGises] = await Promise.all([
		db
			.select({
				gise_hora_entrada: giseEscalas.hora_entrada,
				gise_hora_saida: giseEscalas.hora_saida,
				sec_hora_entrada: giseSeccionais.hora_entrada,
				sec_hora_saida: giseSeccionais.hora_saida,
				eq_hora_entrada: giseEquipes.hora_entrada,
				eq_hora_saida: giseEquipes.hora_saida
			})
			.from(giseMembros)
			.innerJoin(giseEquipes, eq(giseMembros.equipe_id, giseEquipes.id))
			.innerJoin(giseSeccionais, eq(giseEquipes.gise_seccional_id, giseSeccionais.id))
			.innerJoin(giseEscalas, eq(giseSeccionais.gise_id, giseEscalas.id))
			.where(
				and(
					eq(giseMembros.policial_id, policialId),
					ne(giseEscalas.id, giseId),
					ne(giseEscalas.status, 'finalizada'),
					eq(giseEscalas.data_inicio, gise.data_inicio)
				)
			)
			.all(),
		db
			.select({
				gise_hora_entrada: giseEscalas.hora_entrada,
				gise_hora_saida: giseEscalas.hora_saida
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
					ne(giseEscalas.id, giseId),
					ne(giseEscalas.status, 'finalizada'),
					eq(giseEscalas.data_inicio, gise.data_inicio)
				)
			)
			.all()
	]);

	for (const e of membrosExistentes) {
		const existenteEntrada = e.eq_hora_entrada ?? e.sec_hora_entrada ?? e.gise_hora_entrada;
		const existenteSaida = e.eq_hora_saida ?? e.sec_hora_saida ?? e.gise_hora_saida;
		if (seOverlapam(gise.hora_entrada, gise.hora_saida, existenteEntrada, existenteSaida)) {
			return {
				ok: false,
				motivo: `Policial já escalado como membro em outra GISE neste dia com horário conflitante (${existenteEntrada}–${existenteSaida})`
			};
		}
	}

	for (const g of supervisorGises) {
		if (seOverlapam(gise.hora_entrada, gise.hora_saida, g.gise_hora_entrada, g.gise_hora_saida)) {
			return {
				ok: false,
				motivo: `Policial já escalado como supervisor/SEINT em outra GISE neste dia com horário conflitante (${g.gise_hora_entrada}–${g.gise_hora_saida})`
			};
		}
	}

	return { ok: true };
}
