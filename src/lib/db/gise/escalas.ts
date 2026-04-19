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

import { logger } from '../../server/logger';

import type { GiseDetalhado, GiseUnidadeSlot } from './types';
import { buscarUnidadeIdSupervisaoExtra } from '../../server/gise-supervisao-extra';
import { quadroSupervisaoExtraExigeRelatorio } from '../../gise/gise-supervisao-extra';

export async function listarGiseEscalas(db: Database, supervisorId?: number, policialId?: number) {
	let query = db.select().from(giseEscalas).$dynamic();

	if (supervisorId) {
		query = query.where(eq(giseEscalas.supervisor_id, supervisorId));
	} else if (policialId) {
		// Busca escalas onde o policial é supervisor OU membro
		query = query.where(
			or(
				eq(giseEscalas.supervisor_id, policialId),
				eq(giseEscalas.assessor_id, policialId),
				eq(giseEscalas.seint1_id, policialId),
				eq(giseEscalas.seint2_id, policialId),
				sql`EXISTS (
					SELECT 1 FROM ${giseMembros} m
					JOIN ${giseEquipes} eq ON m.equipe_id = eq.id
					JOIN ${giseSeccionais} s ON eq.gise_seccional_id = s.id
					WHERE s.gise_id = ${giseEscalas.id} AND m.policial_id = ${policialId}
				)`
			)
		);
	}

	const escalas = await query.orderBy(desc(giseEscalas.data_inicio), desc(giseEscalas.id)).all();
	if (escalas.length === 0) return [];

	const escalaIds = escalas.map(e => e.id);

	// Batch all related data in parallel instead of N+1 per escala
	const [saidasRows, secCountRows, assExtraRows, membroSecRows, seccionalIdsRows, equipeTypesRows] = await Promise.all([
		db
			.select({ gise_id: gisePresencas.gise_id })
			.from(gisePresencas)
			.where(and(inArray(gisePresencas.gise_id, escalaIds), isNotNull(gisePresencas.saida_timestamp)))
			.all(),
		db
			.select({ gise_id: giseSeccionais.gise_id, count: sql<number>`count(*)` })
			.from(giseSeccionais)
			.where(inArray(giseSeccionais.gise_id, escalaIds))
			.groupBy(giseSeccionais.gise_id)
			.all(),
		db
			.select({ gise_id: giseAssinaturasRelatorios.gise_id, count: sql<number>`count(*)` })
			.from(giseAssinaturasRelatorios)
			.where(
				and(
					inArray(giseAssinaturasRelatorios.gise_id, escalaIds),
					eq(giseAssinaturasRelatorios.tipo, 'extraordinario')
				)
			)
			.groupBy(giseAssinaturasRelatorios.gise_id)
			.all(),
		policialId
			? db
				.select({ gise_id: giseSeccionais.gise_id, seccional_id: giseSeccionais.seccional_id })
				.from(giseMembros)
				.innerJoin(giseEquipes, eq(giseMembros.equipe_id, giseEquipes.id))
				.innerJoin(giseSeccionais, eq(giseEquipes.gise_seccional_id, giseSeccionais.id))
				.where(and(inArray(giseSeccionais.gise_id, escalaIds), eq(giseMembros.policial_id, policialId)))
				.all()
			: Promise.resolve([]),
		db
			.select({ gise_id: giseSeccionais.gise_id, seccional_id: giseSeccionais.seccional_id, nome: unidades.nome })
			.from(giseSeccionais)
			.innerJoin(unidades, eq(giseSeccionais.seccional_id, unidades.id))
			.where(inArray(giseSeccionais.gise_id, escalaIds))
			.all(),
		db
			.select({
				gise_id: giseSeccionais.gise_id,
				seccional_id: giseSeccionais.seccional_id,
				tipo: giseEquipes.tipo
			})
			.from(giseEquipes)
			.innerJoin(giseSeccionais, eq(giseEquipes.gise_seccional_id, giseSeccionais.id))
			.where(inArray(giseSeccionais.gise_id, escalaIds))
			.all()
	]);

	// Build lookup maps for O(1) access
	const saidasSet = new Set(saidasRows.map(r => r.gise_id));
	const secCountMap = new Map(secCountRows.map(r => [r.gise_id, r.count]));
	const assExtraMap = new Map(assExtraRows.map(r => [r.gise_id, r.count]));
	const membroSecMap = new Map((membroSecRows as Array<{ gise_id: number; seccional_id: number }>).map(r => [r.gise_id, r.seccional_id]));
	const equipeTypesMap = new Map<string, Set<string>>();
	for (const row of equipeTypesRows as Array<{ gise_id: number; seccional_id: number; tipo: string }>) {
		const key = `${row.gise_id}_${row.seccional_id}`;
		if (!equipeTypesMap.has(key)) equipeTypesMap.set(key, new Set());
		equipeTypesMap.get(key)!.add(row.tipo);
	}

	const seccionaisMap = new Map<number, { id: number; nome: string; tipos: string[] }[]>();
	for (const row of seccionalIdsRows as Array<{ gise_id: number; seccional_id: number; nome: string }>) {
		if (!seccionaisMap.has(row.gise_id)) seccionaisMap.set(row.gise_id, []);
		const tipos = [...(equipeTypesMap.get(`${row.gise_id}_${row.seccional_id}`) ?? new Set(['operacional']))];
		seccionaisMap.get(row.gise_id)!.push({ id: row.seccional_id, nome: row.nome, tipos });
	}

	return escalas.map(e => ({
		...e,
		temSaidaConfirmada: saidasSet.has(e.id),
		totalSeccionais: secCountMap.get(e.id) ?? 0,
		assinaturasRelatorioExtra: assExtraMap.get(e.id) ?? 0,
		policialSeccionalId: membroSecMap.get(e.id) ?? null,
		seccionais: seccionaisMap.get(e.id) ?? []
	}));
}

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
	statusInicial: 'em_definicao_supervisor' | 'em_preenchimento' = 'em_definicao_supervisor'
): Promise<number> {
	const result = await db
		.insert(giseEscalas)
		.values({ data_inicio: dataInicio, hora_entrada: horaEntrada, hora_saida: horaSaida, status: statusInicial })
		.returning({ id: giseEscalas.id });
	return result[0].id;
}

/**
 * Carrega uma GISE completa com todas as suas seccionais, equipes, membros e presenças.
 * Usa batch loading para evitar N+1 queries.
 */
export async function buscarGiseDetalhado(
	db: Database,
	id: number
): Promise<GiseDetalhado | null> {
	const gise = await db.select().from(giseEscalas).where(eq(giseEscalas.id, id)).get();
	if (!gise) return null;

	// Carrega dados em paralelo para minimizar round-trips ao banco
	const parallelResults = await Promise.all([
		gise.supervisor_id
			? db
				.select({ nome: policiais.nome, matricula: policiais.matricula, telefone: policiais.telefone })
				.from(policiais)
				.where(eq(policiais.id, gise.supervisor_id))
				.get()
			: Promise.resolve(null),
		gise.assessor_id
			? db
				.select({ nome: policiais.nome, matricula: policiais.matricula, telefone: policiais.telefone })
				.from(policiais)
				.where(eq(policiais.id, gise.assessor_id))
				.get()
			: Promise.resolve(null),
		gise.seint1_id
			? db
				.select({ nome: policiais.nome, matricula: policiais.matricula, telefone: policiais.telefone })
				.from(policiais)
				.where(eq(policiais.id, gise.seint1_id))
				.get()
			: Promise.resolve(null),
		gise.seint2_id
			? db
				.select({ nome: policiais.nome, matricula: policiais.matricula, telefone: policiais.telefone })
				.from(policiais)
				.where(eq(policiais.id, gise.seint2_id))
				.get()
			: Promise.resolve(null),
		db
			.select()
			.from(giseDocumentos)
			.where(eq(giseDocumentos.gise_id, id))
			.get()
			.then((r) => r ?? null),
		db
			.select({
				id: giseSeccionais.id,
				gise_id: giseSeccionais.gise_id,
				seccional_id: giseSeccionais.seccional_id,
				unidade_operacional_id: giseSeccionais.unidade_operacional_id,
				status: giseSeccionais.status,
				hora_entrada: giseSeccionais.hora_entrada,
				hora_saida: giseSeccionais.hora_saida,
				seccional_nome: unidades.nome
			})
			.from(giseSeccionais)
			.innerJoin(unidades, eq(giseSeccionais.seccional_id, unidades.id))
			.where(eq(giseSeccionais.gise_id, id))
			.orderBy(asc(unidades.nome)),
		db
			.select()
			.from(giseEquipes)
			.innerJoin(giseSeccionais, eq(giseEquipes.gise_seccional_id, giseSeccionais.id))
			.where(eq(giseSeccionais.gise_id, id)),
		db
			.select({
				id: giseMembros.id,
				equipe_id: giseMembros.equipe_id,
				policial_id: giseMembros.policial_id,
				policial_nome: policiais.nome,
				policial_cargo: policiais.cargo,
				policial_matricula: policiais.matricula,
				policial_telefone: policiais.telefone,
				policial_lotacao: policiais.lotacao,
				policial_classe: policiais.classe
			})
			.from(giseMembros)
			.innerJoin(policiais, eq(giseMembros.policial_id, policiais.id))
			.innerJoin(giseEquipes, eq(giseMembros.equipe_id, giseEquipes.id))
			.innerJoin(giseSeccionais, eq(giseEquipes.gise_seccional_id, giseSeccionais.id))
			.where(eq(giseSeccionais.gise_id, id)),
		db.select().from(gisePresencas).where(eq(gisePresencas.gise_id, id)),
		db
			.select({ equipe_seccional_id: giseEquipes.gise_seccional_id })
			.from(giseRespostasFormulario)
			.innerJoin(giseMembros, eq(giseRespostasFormulario.policial_id, giseMembros.policial_id))
			.innerJoin(giseEquipes, eq(giseMembros.equipe_id, giseEquipes.id))
			.where(eq(giseRespostasFormulario.gise_id, id)),
		db
			.select({ count: sql<number>`count(*)` })
			.from(giseAssinaturasRelatorios)
			.where(
				and(
					eq(giseAssinaturasRelatorios.gise_id, id),
					eq(giseAssinaturasRelatorios.tipo, 'extraordinario')
				)
			)
			.get()
	]);

	const [supervisorRow, assessorRow, seint1Row, seint2Row, documento, secsRows, todasEquipes, todosMembros, todasPresencas, todasRespostas, assExtraRow] = parallelResults;

	// Carrega slots de unidade por seccional (LEFT JOIN: unidade_id pode ser null)
	let todosSlotsUnidade: Array<{
		id: number;
		gise_seccional_id: number;
		unidade_id: number | null;
		nome: string | null;
	}> = [];
	try {
		todosSlotsUnidade = await db
			.select({
				id: giseSeccionalUnidades.id,
				gise_seccional_id: giseSeccionalUnidades.gise_seccional_id,
				unidade_id: giseSeccionalUnidades.unidade_id,
				nome: unidades.nome
			})
			.from(giseSeccionalUnidades)
			.leftJoin(unidades, eq(giseSeccionalUnidades.unidade_id, unidades.id))
			.innerJoin(giseSeccionais, eq(giseSeccionalUnidades.gise_seccional_id, giseSeccionais.id))
			.where(eq(giseSeccionais.gise_id, id))
			.orderBy(asc(giseSeccionalUnidades.id));
	} catch (err) {
		logger.warn('[buscarGiseDetalhado] slots/unidades — possível migração pendente', {
			gise_id: id,
			err: String(err)
		});
	}

	const supervisor_nome = supervisorRow?.nome ?? null;
	const supervisor_matricula = supervisorRow?.matricula ?? null;

	const temSaidaConfirmada = todasPresencas.some((p) => p.saida_timestamp !== null);

	// Índices em memória para lookups O(1)
	const presencaMap = new Map(todasPresencas.map((p) => [p.policial_id, p]));
	const seccionalComRespostas = new Set(todasRespostas.map((r) => r.equipe_seccional_id));

	// Agrupa slots por seccional
	const slotsPorSeccional = new Map<number, typeof todosSlotsUnidade>();
	for (const slot of todosSlotsUnidade) {
		if (!slotsPorSeccional.has(slot.gise_seccional_id)) {
			slotsPorSeccional.set(slot.gise_seccional_id, []);
		}
		slotsPorSeccional.get(slot.gise_seccional_id)!.push(slot);
	}

	// Agrupa equipes por gise_unidade_id (novo) e por gise_seccional_id (fallback legado)
	const equipesPorUnidade = new Map<number, typeof todasEquipes>();
	const equipesSemUnidadePorSeccional = new Map<number, typeof todasEquipes>();
	for (const row of todasEquipes) {
		const unidadeId = row.gise_equipes.gise_unidade_id;
		if (unidadeId !== null && unidadeId !== undefined) {
			if (!equipesPorUnidade.has(unidadeId)) equipesPorUnidade.set(unidadeId, []);
			equipesPorUnidade.get(unidadeId)!.push(row);
		} else {
			const secId = row.gise_seccionais.id;
			if (!equipesSemUnidadePorSeccional.has(secId)) equipesSemUnidadePorSeccional.set(secId, []);
			equipesSemUnidadePorSeccional.get(secId)!.push(row);
		}
	}

	const membrosPorEquipe = new Map<number, typeof todosMembros>();
	for (const m of todosMembros) {
		if (!membrosPorEquipe.has(m.equipe_id)) membrosPorEquipe.set(m.equipe_id, []);
		membrosPorEquipe.get(m.equipe_id)!.push(m);
	}

	function buildEquipes(rows: typeof todasEquipes) {
		return rows.map((row) => {
			const equipe = row.gise_equipes;
			const membrosRaw = membrosPorEquipe.get(equipe.id) ?? [];
			const membros = membrosRaw.map((m) => ({
				...m,
				presenca: presencaMap.get(m.policial_id) ?? null
			}));
			return { ...equipe, membros };
		});
	}

	const seccionais = secsRows.map((sec) => {
		const slots = slotsPorSeccional.get(sec.id) ?? [];

		let unidades: GiseUnidadeSlot[] = [];
		if (slots.length > 0) {
			unidades = slots.map((slot) => ({
				id: slot.id,
				unidade_id: slot.unidade_id,
				nome: slot.nome,
				equipes: buildEquipes(equipesPorUnidade.get(slot.id) ?? [])
			}));
		}
		// Equipes sem unidade (legado ou mal formadas) aparecem em um slot avulso com ID 0
		const equipesLegado = buildEquipes(equipesSemUnidadePorSeccional.get(sec.id) ?? []);
		if (equipesLegado.length > 0) {
			unidades.unshift({ id: 0, unidade_id: null, nome: null, equipes: equipesLegado });
		}

		return {
			...sec,
			unidades,
			temRespostas: seccionalComRespostas.has(sec.id)
		};
	});

	return {
		...gise,
		seccionais,
		supervisor_nome: supervisorRow?.nome ?? null,
		supervisor_matricula: supervisorRow?.matricula ?? null,
		supervisor_telefone: supervisorRow?.telefone ?? null,
		assessor_nome: assessorRow?.nome ?? null,
		assessor_matricula: assessorRow?.matricula ?? null,
		assessor_telefone: assessorRow?.telefone ?? null,
		seint1_nome: seint1Row?.nome ?? null,
		seint1_matricula: seint1Row?.matricula ?? null,
		seint1_telefone: seint1Row?.telefone ?? null,
		seint2_nome: seint2Row?.nome ?? null,
		seint2_matricula: seint2Row?.matricula ?? null,
		seint2_telefone: seint2Row?.telefone ?? null,
		documento,
		totalSeccionais: seccionais.length,
		assinaturasRelatorioExtra: assExtraRow?.count ?? 0,
		temSaidaConfirmada
	};
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
		atualizarGiseEscala(db, giseId, { status: 'em_preenchimento' })
	]);
}

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
		.leftJoin(gisePresencas, and(
			eq(gisePresencas.gise_id, giseId),
			eq(gisePresencas.policial_id, giseMembros.policial_id)
		))
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
 * Quando todos confirmaram saída e os relatórios de produtividade estão completos,
 * avança para assinatura dos relatórios de extra. Se todos saíram mas faltam relatórios,
 * passa de `em_andamento` para `aguardando_relatorios`.
 *
 * Importante: também cobre o caso em que a escala já está em `aguardando_relatorios`
 * e a última saída (ou retificação de presença) só entra depois — antes o código só
 * reagia em `em_andamento`, deixando o status preso.
 */
export async function sincronizarStatusGiseAposPresencaRelatorios(db: Database, giseId: number): Promise<void> {
	const gise = await buscarGiseEscala(db, giseId);
	if (!gise) return;
	if (gise.status !== 'em_andamento' && gise.status !== 'aguardando_relatorios') return;

	const [todosSairam, todosEnviaram] = await Promise.all([
		verificarTodosSairam(db, giseId),
		verificarTodosRelatoriosEnviados(db, giseId)
	]);

	if (!todosSairam) return;

	if (todosEnviaram) {
		await atualizarGiseEscala(db, giseId, { status: 'aguardando_assinatura_relat' });
		return;
	}

	if (gise.status === 'em_andamento') {
		await atualizarGiseEscala(db, giseId, { status: 'aguardando_relatorios' });
	}
}

/**
 * Verifica se todas as equipes enviaram seus relatórios de produtividade,
 * além dos relatórios individuais das inteligências (SEINT1 e SEINT2) da supervisão.
 */
export async function verificarTodosRelatoriosEnviados(db: Database, giseId: number): Promise<boolean> {
	const result = await db
		.select({
			total: sql<number>`count(distinct ${giseEquipes.id})`,
			com_resposta: sql<number>`count(distinct ${giseRespostasFormulario.equipe_id})`
		})
		.from(giseEquipes)
		.innerJoin(giseSeccionais, eq(giseEquipes.gise_seccional_id, giseSeccionais.id))
		.leftJoin(giseRespostasFormulario, and(
			eq(giseRespostasFormulario.gise_id, giseId),
			eq(giseRespostasFormulario.equipe_id, giseEquipes.id)
		))
		.where(eq(giseSeccionais.gise_id, giseId))
		.get();

	let total = result?.total ?? 0;
	let comResposta = result?.com_resposta ?? 0;

	// Adiciona validação dos formulários avulsos do SEINT da equipe de supervisão
	const gise = await db.select().from(giseEscalas).where(eq(giseEscalas.id, giseId)).get();
	if (gise) {
		const seintIds = [...new Set([gise.seint1_id, gise.seint2_id].filter((id): id is number => id != null))];
		if (seintIds.length > 0) {
			const respostasSups = await db
				.select({ policial_id: giseRespostasFormulario.policial_id })
				.from(giseRespostasFormulario)
				.where(and(eq(giseRespostasFormulario.gise_id, giseId), inArray(giseRespostasFormulario.policial_id, seintIds)))
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
export async function verificarTodosRelatoriosExtraAssinados(db: Database, giseId: number): Promise<boolean> {
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

export async function clonarGiseParaData(
	db: Database,
	giseId: number,
	novaData: string,
	modo: 'clonada' | 'completa' = 'clonada',
	horaEntrada?: string,
	horaSaida?: string
): Promise<number> {
	const gise = await db.select().from(giseEscalas).where(eq(giseEscalas.id, giseId)).get();
	if (!gise) throw new Error('GISE não encontrada');

	const novoId = await criarGiseEscala(
		db,
		novaData,
		horaEntrada ?? gise.hora_entrada,
		horaSaida ?? gise.hora_saida
	);

	let secsParaClonar: any[] = [];

	if (modo === 'clonada') {
		secsParaClonar = await db.select().from(giseSeccionais).where(eq(giseSeccionais.gise_id, giseId)).all();
	} else {
		const todas = await db.select().from(unidades).where(eq(unidades.tipo, 'seccional')).all();
		secsParaClonar = todas.map((s) => ({ seccional_id: s.id }));
	}

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
		const oldSecIds = secsParaClonar.filter((s: any) => s.id).map((s: any) => s.id);
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
					slots_dpc: 1,
					slots_oip: 3
				},
				{
					gise_seccional_id: secId,
					gise_unidade_id: slot.id,
					tipo: 'seint' as const,
					slots_dpc: 0,
					slots_oip: 2
				}
			]);
		}
	}

	return novoId;
}

export async function isSupervisorGiseAtiva(db: Database, policialId: number): Promise<boolean> {
	const result = await db
		.select({ id: giseEscalas.id })
		.from(giseEscalas)
		.where(and(ne(giseEscalas.status, 'finalizada'), eq(giseEscalas.supervisor_id, policialId)))
		.limit(1)
		.get();
	return !!result;
}

export async function isMembroGiseAtiva(db: Database, policialId: number): Promise<boolean> {
	const result = await db
		.select({ id: giseMembros.id })
		.from(giseMembros)
		.innerJoin(giseEquipes, eq(giseMembros.equipe_id, giseEquipes.id))
		.innerJoin(giseSeccionais, eq(giseEquipes.gise_seccional_id, giseSeccionais.id))
		.innerJoin(giseEscalas, eq(giseSeccionais.gise_id, giseEscalas.id))
		.where(and(eq(giseMembros.policial_id, policialId), ne(giseEscalas.status, 'finalizada')))
		.get();
	return !!result;
}

/** Assessor ou SEINT do quadro de supervisão em GISE não finalizada (acesso a Res. GISE, etc.). */
export async function isSupervisaoGiseAtiva(db: Database, policialId: number): Promise<boolean> {
	const result = await db
		.select({ id: giseEscalas.id })
		.from(giseEscalas)
		.where(
			and(
				ne(giseEscalas.status, 'finalizada'),
				or(
					eq(giseEscalas.assessor_id, policialId),
					eq(giseEscalas.seint1_id, policialId),
					eq(giseEscalas.seint2_id, policialId)
				)
			)
		)
		.limit(1)
		.get();
	return !!result;
}
