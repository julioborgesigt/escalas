/**
 * Escalar e desescalar policial em equipe de GISE — mais as três checagens de
 * conflito que impedem escalar a mesma pessoa duas vezes.
 *
 * O insert é CRU: `adicionarGiseMembro` não valida nada, e não há constraint
 * que o cubra (a unicidade que importaria é `(gise_id, policial_id)`, que
 * atravessa três tabelas e não cabe num UNIQUE). Toda a proteção é de
 * aplicação, e é responsabilidade de QUEM CHAMA rodar antes:
 *   - `verificarConflitoMembroGise` — um policial serve em UMA equipe por GISE;
 *   - `verificarConflitoHorarioPolicial` — choque de horário ao entrar em
 *     equipe, contra outras GISEs E contra escala comum
 *     (`verificarConflitoEscalasNaoGise`, de `server/escala-conflict`);
 *   - `verificarConflitoHorarioPorGise` — o mesmo para quem entra como
 *     supervisor/assessor/SEINT, que não é membro de equipe.
 * Pular a checagem não dá erro: gera silenciosamente um policial em dois
 * lugares ao mesmo tempo.
 *
 * O horário efetivo é uma CASCATA de três níveis — equipe → seccional → GISE,
 * com o primeiro não-nulo vencendo. Comparar direto `giseEscalas.hora_entrada`
 * ignora a equipe que tem horário próprio, que é exatamente o caso em que o
 * conflito aparece.
 */
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

/**
 * Escala o policial na equipe. INSERT cru, sem validação: as duas checagens que
 * importam — já estar nesta GISE (`verificarConflitoMembroGise`) e choque de
 * horário (`verificarConflitoHorarioPolicial`) — são responsabilidade do
 * chamador, e não há constraint no banco que as substitua.
 */
export async function adicionarGiseMembro(db: Database, equipeId: number, policialId: number) {
	return db.insert(giseMembros).values({ equipe_id: equipeId, policial_id: policialId });
}

/**
 * Desescala o policial pelo id da LINHA de `gise_membros` (não pelo id do
 * policial): o mesmo policial pode ter mais de uma linha, e remover a errada
 * tiraria a pessoa da equipe errada.
 *
 * A presença já registrada (`gise_presencas`) NÃO é apagada — ela é vinculada à
 * GISE e ao policial, não à equipe. Quem remove alguém que já confirmou entrada
 * precisa tratar isso à parte.
 */
export async function removerGiseMembro(db: Database, id: number) {
	return db.delete(giseMembros).where(eq(giseMembros.id, id));
}

/**
 * O policial já está escalado nesta GISE, em qualquer seccional? Devolve
 * `{ ok: false, motivo }` com a seccional em que ele está, para a mensagem de
 * erro dizer ONDE — sem isso o admin que recebe "já escalado" não sabe onde
 * procurar.
 *
 * Regra: um policial serve em UMA equipe por GISE. É checagem de aplicação, não
 * do banco (não há unique em `(gise_id, policial_id)`, que teria de atravessar
 * duas tabelas).
 */
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
