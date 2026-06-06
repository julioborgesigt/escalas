import { eq, and, or, sql, inArray } from 'drizzle-orm';
import {
	giseEscalas,
	giseSeccionais,
	giseEquipes,
	giseMembros,
	gisePresencas,
	giseDocumentos,
	giseAssinaturasRelatorios,
	giseRespostasFormulario
} from '../../server/schema';
import type { Database } from '../core';
import { buscarGiseEscala, atualizarGiseEscala } from './escalas-crud';
import { buscarUnidadeIdSupervisaoExtra } from '../../server/gise-supervisao-extra';
import { quadroSupervisaoExtraExigeRelatorio } from '../../gise/gise-supervisao-extra';

export async function verificarGiseCompleta(db: Database, giseId: number): Promise<boolean> {
	const naoPreenchidas = await db
		.select({ id: giseSeccionais.id })
		.from(giseSeccionais)
		.where(
			and(
				eq(giseSeccionais.gise_id, giseId),
				or(eq(giseSeccionais.status, 'pendente'), eq(giseSeccionais.status, 'retificada'))
			)
		);
	return naoPreenchidas.length === 0;
}

/**
 * Verifica se todos os membros escalados + quadro de supervisão confirmaram entrada.
 */
export async function verificarTodosEntraram(db: Database, giseId: number): Promise<boolean> {
	const result = await db
		.select({
			total: sql<number>`count(*)`,
			com_entrada: sql<number>`count(${gisePresencas.entrada_timestamp})`
		})
		.from(giseMembros)
		.innerJoin(giseEquipes, eq(giseMembros.equipe_id, giseEquipes.id))
		.innerJoin(giseSeccionais, eq(giseEquipes.gise_seccional_id, giseSeccionais.id))
		.leftJoin(
			gisePresencas,
			and(eq(gisePresencas.gise_id, giseId), eq(gisePresencas.policial_id, giseMembros.policial_id))
		)
		.where(eq(giseSeccionais.gise_id, giseId))
		.get();

	let total = result?.total ?? 0;
	let comEntrada = result?.com_entrada ?? 0;

	const gise = await db.select().from(giseEscalas).where(eq(giseEscalas.id, giseId)).get();
	if (gise) {
		const supIds = [
			...new Set(
				[gise.supervisor_id, gise.assessor_id, gise.seint1_id, gise.seint2_id].filter(
					(id): id is number => id != null
				)
			)
		];
		if (supIds.length > 0) {
			const presencasSups = await db
				.select({ id: gisePresencas.id, entrada: gisePresencas.entrada_timestamp })
				.from(gisePresencas)
				.where(and(eq(gisePresencas.gise_id, giseId), inArray(gisePresencas.policial_id, supIds)))
				.all();

			total += supIds.length;
			comEntrada += presencasSups.filter((p) => p.entrada !== null).length;
		}
	}

	if (total === 0) return false;
	return comEntrada >= total;
}

/**
 * Verifica se todos os membros escalados confirmaram saída.
 * Retorna true quando todos têm saida_timestamp preenchido.
 * Usa agregação condicional em query única em vez de 2 queries separadas.
 */
export async function verificarTodosSairam(db: Database, giseId: number): Promise<boolean> {
	// Membros normais das equipes das seccionais
	const result = await db
		.select({
			total: sql<number>`count(*)`,
			com_saida: sql<number>`count(${gisePresencas.saida_timestamp})`
		})
		.from(giseMembros)
		.innerJoin(giseEquipes, eq(giseMembros.equipe_id, giseEquipes.id))
		.innerJoin(giseSeccionais, eq(giseEquipes.gise_seccional_id, giseSeccionais.id))
		.leftJoin(
			gisePresencas,
			and(eq(gisePresencas.gise_id, giseId), eq(gisePresencas.policial_id, giseMembros.policial_id))
		)
		.where(eq(giseSeccionais.gise_id, giseId))
		.get();

	let total = result?.total ?? 0;
	let comSaida = result?.com_saida ?? 0;

	// Supervisão: supervisor, assessor e SEINTs (IDs distintos)
	const gise = await db.select().from(giseEscalas).where(eq(giseEscalas.id, giseId)).get();
	if (gise) {
		const supIds = [
			...new Set(
				[gise.supervisor_id, gise.assessor_id, gise.seint1_id, gise.seint2_id].filter(
					(id): id is number => id != null
				)
			)
		];
		if (supIds.length > 0) {
			const presencasSups = await db
				.select({ id: gisePresencas.id, saida: gisePresencas.saida_timestamp })
				.from(gisePresencas)
				.where(and(eq(gisePresencas.gise_id, giseId), inArray(gisePresencas.policial_id, supIds)))
				.all();

			total += supIds.length;
			comSaida += presencasSups.filter((p) => p.saida !== null).length;
		}
	}

	if (total === 0) return false;
	return comSaida >= total;
}

/**
 * Transições após presença (entrada/saída) em `/res-gise`:
 *   • `em_andamento` → `aguardando_relatorios` quando **todos confirmaram entrada**;
 *   • `aguardando_relatorios` → `aguardando_assinatura_relat` quando **todos confirmaram saída**;
 *   • `em_andamento` → `aguardando_assinatura_relat` se entrada e saída já estão completas de uma vez.
 *
 * `pronta_para_finalizar` não depende mais de relatórios de produtividade; é tratada em
 * {@link tentarPromoverGiseProntaParaFinalizar} (documento GISE assinado + relatórios de extra assinados).
 */
export async function sincronizarStatusGiseAposPresencaRelatorios(
	db: Database,
	giseId: number
): Promise<void> {
	const gise = await buscarGiseEscala(db, giseId);
	if (!gise) return;
	if (
		!['em_andamento', 'aguardando_relatorios', 'aguardando_assinatura_relat'].includes(gise.status)
	)
		return;

	const [todosEntraram, todosSairam] = await Promise.all([
		verificarTodosEntraram(db, giseId),
		verificarTodosSairam(db, giseId)
	]);

	let next = gise.status;

	if (gise.status === 'em_andamento') {
		if (todosEntraram && todosSairam) next = 'aguardando_assinatura_relat';
		else if (todosEntraram) next = 'aguardando_relatorios';
	} else if (gise.status === 'aguardando_relatorios') {
		if (todosSairam) next = 'aguardando_assinatura_relat';
	}

	if (next !== gise.status) {
		await atualizarGiseEscala(db, giseId, { status: next });
	}

	await tentarPromoverGiseProntaParaFinalizar(db, giseId);
}

/**
 * Promove para `pronta_para_finalizar` quando a escala GISE já tem documento assinado
 * e todos os relatórios de extra estão assinados (enquanto em `aguardando_assinatura_relat`).
 */
export async function tentarPromoverGiseProntaParaFinalizar(
	db: Database,
	giseId: number
): Promise<void> {
	const gise = await buscarGiseEscala(db, giseId);
	if (!gise || gise.status !== 'aguardando_assinatura_relat') return;

	const doc = await db
		.select({ id: giseDocumentos.id })
		.from(giseDocumentos)
		.where(eq(giseDocumentos.gise_id, giseId))
		.get();
	if (!doc) return;

	const extrasOk = await verificarTodosRelatoriosExtraAssinados(db, giseId);
	if (!extrasOk) return;

	await atualizarGiseEscala(db, giseId, { status: 'pronta_para_finalizar' });
}

/**
 * Verifica se todas as equipes enviaram seus relatórios de produtividade,
 * além dos relatórios individuais das inteligências (SEINT1 e SEINT2) da supervisão.
 */
export async function verificarTodosRelatoriosEnviados(
	db: Database,
	giseId: number
): Promise<boolean> {
	const result = await db
		.select({
			total: sql<number>`count(distinct ${giseEquipes.id})`,
			com_resposta: sql<number>`count(distinct ${giseRespostasFormulario.equipe_id})`
		})
		.from(giseEquipes)
		.innerJoin(giseSeccionais, eq(giseEquipes.gise_seccional_id, giseSeccionais.id))
		.leftJoin(
			giseRespostasFormulario,
			and(
				eq(giseRespostasFormulario.gise_id, giseId),
				eq(giseRespostasFormulario.equipe_id, giseEquipes.id)
			)
		)
		.where(eq(giseSeccionais.gise_id, giseId))
		.get();

	let total = result?.total ?? 0;
	let comResposta = result?.com_resposta ?? 0;

	// Adiciona validação dos formulários avulsos do SEINT da equipe de supervisão
	const gise = await db.select().from(giseEscalas).where(eq(giseEscalas.id, giseId)).get();
	if (gise) {
		const seintIds = [
			...new Set([gise.seint1_id, gise.seint2_id].filter((id): id is number => id != null))
		];
		if (seintIds.length > 0) {
			const respostasSups = await db
				.select({ policial_id: giseRespostasFormulario.policial_id })
				.from(giseRespostasFormulario)
				.where(
					and(
						eq(giseRespostasFormulario.gise_id, giseId),
						inArray(giseRespostasFormulario.policial_id, seintIds)
					)
				)
				.all();

			const policiaisComRelatorio = new Set(
				respostasSups.map((r) => r.policial_id).filter((id): id is number => id != null)
			);

			total += seintIds.length;
			comResposta += policiaisComRelatorio.size;
		}
	}

	if (total === 0) return false;
	return comResposta >= total;
}

/**
 * Verifica se todos os relatórios de extra estão assinados (uma por seccional
 * da GISE +, quando houver quadro de supervisão, um relatório adicional do quadro).
 */
export async function verificarTodosRelatoriosExtraAssinados(
	db: Database,
	giseId: number
): Promise<boolean> {
	const gise = await buscarGiseEscala(db, giseId);
	if (!gise) return false;

	const secResult = await db
		.select({
			total: sql<number>`count(*)`,
			assinadas: sql<number>`count(${giseAssinaturasRelatorios.id})`
		})
		.from(giseSeccionais)
		.leftJoin(
			giseAssinaturasRelatorios,
			and(
				eq(giseAssinaturasRelatorios.gise_id, giseId),
				eq(giseAssinaturasRelatorios.seccional_id, giseSeccionais.seccional_id),
				eq(giseAssinaturasRelatorios.tipo, 'extraordinario')
			)
		)
		.where(eq(giseSeccionais.gise_id, giseId))
		.get();

	const secTotal = secResult?.total ?? 0;
	const secAss = secResult?.assinadas ?? 0;

	const supUid = await buscarUnidadeIdSupervisaoExtra(db);
	const precisaSup = quadroSupervisaoExtraExigeRelatorio(gise);

	let supNeed = 0;
	let supOk = 0;
	if (precisaSup && supUid != null) {
		supNeed = 1;
		const row = await db
			.select({ id: giseAssinaturasRelatorios.id })
			.from(giseAssinaturasRelatorios)
			.where(
				and(
					eq(giseAssinaturasRelatorios.gise_id, giseId),
					eq(giseAssinaturasRelatorios.seccional_id, supUid),
					eq(giseAssinaturasRelatorios.tipo, 'extraordinario')
				)
			)
			.get();
		supOk = row ? 1 : 0;
	}

	const total = secTotal + supNeed;
	const ok = secAss + supOk;
	if (total === 0) return false;
	return ok >= total;
}
