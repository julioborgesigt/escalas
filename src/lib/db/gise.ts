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
} from '../server/schema';
import { getNowBR } from '../utils';
import { logger } from '../server/logger';
import type * as schema from '../server/schema';
import type { Database } from './core';

// ---- Tipos ----

export type GiseMembro = schema.GiseMembro & {
	policial_nome: string;
	policial_cargo: string;
	policial_matricula: string;
	policial_telefone: string | null;
	policial_lotacao: string | null;
	policial_classe: string | null;
	presenca: schema.GisePresenca | null;
};

export type GiseEquipeComMembros = schema.GiseEquipe & { membros: GiseMembro[] };

export interface GiseUnidadeSlot {
	id: number;           // gise_seccional_unidades.id
	unidade_id: number | null;
	nome: string | null;  // null quando sem unidade definida
	equipes: GiseEquipeComMembros[];
}

export interface GiseDetalhado extends schema.GiseEscala {
	seccionais: Array<
		schema.GiseSeccional & {
			seccional_nome: string;
			temRespostas: boolean;
			unidades: GiseUnidadeSlot[];
		}
	>;
	supervisor_nome: string | null;
	supervisor_matricula: string | null;
	documento: schema.GiseDocumento | null;
	totalSeccionais: number;
	assinaturasRelatorioExtra: number;
	temSaidaConfirmada: boolean;
}

// ---- Listagem e busca ----

export async function listarGiseEscalas(db: Database, supervisorId?: number, policialId?: number) {
	let query = db.select().from(giseEscalas).$dynamic();

	if (supervisorId) {
		query = query.where(eq(giseEscalas.supervisor_id, supervisorId));
	} else if (policialId) {
		// Busca escalas onde o policial é supervisor OU membro
		query = query.where(
			or(
				eq(giseEscalas.supervisor_id, policialId),
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
	const [
		supervisorRow,
		documento,
		secsRows,
		todasEquipes,
		todosMembros,
		todasPresencas,
		todasRespostas,
		assExtraRow
	] = await Promise.all([
		gise.supervisor_id
			? db
				.select({ nome: policiais.nome, matricula: policiais.matricula })
				.from(policiais)
				.where(eq(policiais.id, gise.supervisor_id))
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
	} catch {
		// Tabela pode não existir ainda — migração pendente
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

		// Se há slots, cada slot tem suas próprias equipes
		// Se não há slots, equipes ficam no nível seccional (legado, migrado pela 0054)
		let unidades: GiseUnidadeSlot[];
		if (slots.length > 0) {
			unidades = slots.map((slot) => ({
				id: slot.id,
				unidade_id: slot.unidade_id,
				nome: slot.nome,
				equipes: buildEquipes(equipesPorUnidade.get(slot.id) ?? [])
			}));
		} else {
			// Legado: cria um slot fictício com equipes da seccional
			const equipesLegado = buildEquipes(equipesSemUnidadePorSeccional.get(sec.id) ?? []);
			unidades = equipesLegado.length > 0
				? [{ id: 0, unidade_id: null, nome: null, equipes: equipesLegado }]
				: [];
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
		supervisor_nome,
		supervisor_matricula,
		documento,
		totalSeccionais: seccionais.length,
		assinaturasRelatorioExtra: assExtraRow?.count ?? 0,
		temSaidaConfirmada
	};
}

// ---- Atualização de GISE ----

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

	// Cria 1 slot de unidade em branco (sem unidade definida) com equipe padrão
	const [slotResult] = await db
		.insert(giseSeccionalUnidades)
		.values({ gise_seccional_id: secId, unidade_id: null })
		.returning({ id: giseSeccionalUnidades.id });
	if (slotResult) {
		await db.insert(giseEquipes).values({
			gise_seccional_id: secId,
			gise_unidade_id: slotResult.id,
			tipo: 'operacional',
			slots_dpc: 1,
			slots_oip: 3
		});
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

export async function reabrirGiseEscala(db: Database, giseId: number) {
	// Todas as operações são independentes — executa em paralelo
	await Promise.all([
		db.delete(giseDocumentos).where(eq(giseDocumentos.gise_id, giseId)),
		db.delete(giseAssinaturasRelatorios).where(eq(giseAssinaturasRelatorios.gise_id, giseId)),
		db.delete(gisePresencas).where(eq(gisePresencas.gise_id, giseId)),
		atualizarGiseEscala(db, giseId, { status: 'em_preenchimento' })
	]);
}

// ---- Membros ----

export async function adicionarGiseMembro(db: Database, equipeId: number, policialId: number) {
	return db.insert(giseMembros).values({ equipe_id: equipeId, policial_id: policialId });
}

export async function removerGiseMembro(db: Database, id: number) {
	return db.delete(giseMembros).where(eq(giseMembros.id, id));
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

	if (!result || result.total === 0) return false;
	return (result.com_saida ?? 0) >= result.total;
}

/**
 * Verifica se todas as equipes enviaram seus relatórios de produtividade.
 * Usa agregação condicional em query única.
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

	if (!result || result.total === 0) return false;
	return (result.com_resposta ?? 0) >= result.total;
}

/**
 * Verifica se todos os relatórios de extra estão assinados (uma por seccional).
 * Usa agregação condicional em query única.
 */
export async function verificarTodosRelatoriosExtraAssinados(db: Database, giseId: number): Promise<boolean> {
	const result = await db
		.select({
			total: sql<number>`count(*)`,
			assinadas: sql<number>`count(${giseAssinaturasRelatorios.id})`
		})
		.from(giseSeccionais)
		.leftJoin(giseAssinaturasRelatorios, and(
			eq(giseAssinaturasRelatorios.gise_id, giseId),
			eq(giseAssinaturasRelatorios.seccional_id, giseSeccionais.seccional_id),
			eq(giseAssinaturasRelatorios.tipo, 'extraordinario')
		))
		.where(eq(giseSeccionais.gise_id, giseId))
		.get();

	if (!result || result.total === 0) return false;
	return (result.assinadas ?? 0) >= result.total;
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

			await db.insert(giseEquipes).values({
				gise_seccional_id: secId,
				gise_unidade_id: slot.id,
				tipo: 'operacional' as const,
				slots_dpc: 1,
				slots_oip: 3
			});
		}
	}

	return novoId;
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

// ---- Formulário de Produtividade ----

const DEFAULT_QUESTIONS = [
	{ id: 1, texto: '1. VTR E PLACA', tipo: 'vtr_placa', key: 'vtr_placa', filhos: [] },
	{ id: 2, texto: '2. KM INICIAL', tipo: 'numero', key: 'km_inicial', filhos: [] },
	{ id: 3, texto: '3. KM FINAL', tipo: 'numero', key: 'km_final', filhos: [] },
	{ id: 4, texto: '4. HOUVE PROCEDIMENTOS EM FLAGRANTE REALIZADOS?', tipo: 'prisoes_maiores', key: 'procedimentos_flagrante_bool', subtexto_qtd: '4.1 QUANTIDADE:', subtexto_lista: '4.2 INFORMAR NOMES E PROCEDIMENTOS:', filhos: [] },
	{ id: 5, texto: '5. MANDADOS CUMPRIDOS (MAIORES)', tipo: 'mandados_maiores', key: 'mandados_cumpridos', filhos: [] },
	{ id: 6, texto: '6. APREENSÕES CUMPRIDAS (MENORES)', tipo: 'apreensoes_menores', key: 'apreensoes_cumpridas', filhos: [] },
	{ id: 7, texto: '7. PRISÕES/APREENSÕES FLAGRANTE', tipo: 'select_99', key: 'prisoes_apreensoes_flagrante', filhos: [] },
	{ id: 8, texto: '8. TENTATIVA CUMPRIMENTO MANDADO', tipo: 'sim_nao', key: 'tentativa_mandado', filhos: [] },
	{ id: 9, texto: '9. MANDADO BUSCA E APREENSÃO', tipo: 'sim_nao', key: 'busca_apreensao', filhos: [] },
	{ id: 10, texto: '10. APREENSÃO DE DROGAS', tipo: 'drogas_complex', key: 'apreensoes_drogas', filhos: [] },
	{ id: 11, texto: '11. HOUVE APREENSÃO DE ARMAS/MUNIÇÕES?', tipo: 'armas_complex', key: 'apreensoes_armas_bool', subtexto_tipo: '11.1 TIPO DE ARMA:', subtexto_qtd: '11.1.1 QUANTIDADE:', filhos: [] },
	{ id: 12, texto: '12. LOCAL DE CRIME', tipo: 'select_99', key: 'local_crime', filhos: [] },
	{ id: 13, texto: '13. ORDEM DE MISSÃO CUMPRIDA', tipo: 'select_99', key: 'ordem_missao', filhos: [] },
	{ id: 14, texto: '14. LEVANTAMENTO DE ALVOS', tipo: 'select_99', key: 'levantamento_alvos', filhos: [] },
	{ id: 15, texto: '15. OITIVAS REALIZADAS', tipo: 'select_99', key: 'oitivas', filhos: [] },
	{ id: 16, texto: '16. REPRESENTAÇÃO PRISÃO', tipo: 'select_99', key: 'representacao_prisao', filhos: [] },
	{ id: 17, texto: '17. REPRESENTAÇÃO BUSCA', tipo: 'select_99', key: 'representacao_busca', filhos: [] },
	{ id: 18, texto: '18. Nº ABORDAGENS', tipo: 'select_99', key: 'abordagens', filhos: [] },
	{ id: 19, texto: '19. RESUMO DILIGÊNCIAS', tipo: 'textarea', key: 'descricao', filhos: [] }
];

const DEFAULT_SEINT_QUESTIONS = [
	{
		id: 1, texto: '1. Houve EXTRAÇÃO DE DADOS DE APARELHOS CELULARES?', tipo: 'sim_nao', key: 'extracao_celulares', filhos: [
			{ id: 101, texto: '1.1 Quantidade de aparelhos analisados (1 a 99)', tipo: 'numero', key: 'extracao_qtd', filhos: [] },
			{ id: 102, texto: '1.2 Listagem de aparelhos analisados (Modelo, Nº proc, Delegacia, Concluída)', tipo: 'textarea', key: 'extracao_lista', filhos: [] }
		]
	},
	{
		id: 2, texto: '2. Houve ANÁLISE DE DADOS DE EXTRAÇÃO?', tipo: 'sim_nao', key: 'analise_extracao', filhos: [
			{ id: 201, texto: '2.1 Quantidade de aparelhos analisados (1 a 99)', tipo: 'numero', key: 'analise_qtd', filhos: [] },
			{ id: 202, texto: '2.2 Listagem de aparelhos analisados (Tamanho, Modelo, Nº proc, Delegacia)', tipo: 'textarea', key: 'analise_lista', filhos: [] }
		]
	},
	{
		id: 3, texto: '3. Houve PRODUÇÃO DE RELATÓRIOS?', tipo: 'sim_nao', key: 'producao_relatorios', filhos: [
			{ id: 301, texto: '3.1 Quantidade de relatórios produzidos (1 a 99)', tipo: 'numero', key: 'relatorios_qtd', filhos: [] },
			{ id: 302, texto: '3.2 Listagem de relatórios produzidos (Nº Relatório, Alvos, Proc. Vinculado, Delegacia)', tipo: 'textarea', key: 'relatorios_lista', filhos: [] }
		]
	},
	{
		id: 4, texto: '4. Houve LEVANTAMENTO DE DADOS DE ALVOS FORAGIDOS?', tipo: 'sim_nao', key: 'levantamento_foragidos', filhos: [
			{ id: 401, texto: '4.1 Quantidade de levantamentos produzidos (1 a 99)', tipo: 'numero', key: 'levantamentos_qtd', filhos: [] },
			{ id: 402, texto: '4.2 Listagem de relatórios produzidos (Nome do Alvo, Proc. Vinculado, Delegacia, Resultado)', tipo: 'textarea', key: 'levantamentos_lista', filhos: [] }
		]
	},
	{
		id: 5, texto: '5. Houve INTERCEPTAÇÃO TELEFÔNICA?', tipo: 'sim_nao', key: 'interceptacao_tel', filhos: [
			{ id: 501, texto: '5.1 Quantidade de INTERCEPTAÇÃO TELEFÔNICA (1 a 99)', tipo: 'numero', key: 'interceptacao_qtd', filhos: [] },
			{
				id: 502, texto: '5.2 Existem OPERAÇÕES que necessitaram de acompanhamento?', tipo: 'sim_nao', key: 'operacoes_acompanhamento_bool', filhos: [
					{ id: 503, texto: '5.2.1 Listagem de OPERAÇÕES (Nome da operação e Delegacia de origem)', tipo: 'textarea', key: 'operacoes_lista', filhos: [] }
				]
			}
		]
	}
];

export async function buscarRespostasProdutividadeSeccional(
	db: any,
	giseId: number,
	seccionalId: number
) {
	const [configRows, rows] = await Promise.all([
		db.select().from(giseModeloFormulario).all(),
		db
			.select({
				equipe_id: giseRespostasFormulario.equipe_id,
				respostas: giseRespostasFormulario.respostas,
				equipe_tipo: giseEquipes.tipo
			})
			.from(giseRespostasFormulario)
			.innerJoin(giseEquipes, eq(giseRespostasFormulario.equipe_id, giseEquipes.id))
			.where(
				and(
					eq(giseRespostasFormulario.gise_id, giseId),
					eq(giseEquipes.gise_seccional_id, seccionalId)
				)
			)
			.all()
	]);
	const modelosMap = new Map();
	configRows.forEach((row: any) => {
		try {
			modelosMap.set(row.tipo, JSON.parse(row.config));
		} catch (e) {
			logger.error('Erro ao parsear modelo GISE', { tipo: row.tipo, err: String(e) });
		}
	});

	const allResults: { equipe_id: number; pergunta: string; resposta: string }[] = [];

	const processarPerguntas = (listaPerguntas: any[], resps: any, eqId: number) => {
		for (const p of listaPerguntas) {
			const resp = resps[p.key] ?? resps[String(p.id)] ?? resps[p.id];
			if (resp !== undefined && resp !== null && resp !== '') {
				allResults.push({ equipe_id: eqId, pergunta: p.texto, resposta: String(resp) });

				const isSim = String(resp).toLowerCase() === 'sim' || resp === true;

				if (isSim || p.tipo === 'operacoes_seint_pura') {
					if (p.tipo === 'mandados_maiores' && resps.mandados_lista) {
						resps.mandados_lista.forEach((item: any, idx: number) => {
							if (item.nome || item.mandado) {
								allResults.push({ equipe_id: eqId, pergunta: `  ↳ Mandado ${idx + 1}`, resposta: `${item.nome} - ${item.mandado}` });
							}
						});
					}
					if (p.tipo === 'prisoes_maiores' && resps.prisoes_lista) {
						resps.prisoes_lista.forEach((item: any, idx: number) => {
							if (item.nome || item.mandado) {
								allResults.push({ equipe_id: eqId, pergunta: `  ↳ Procedimento ${idx + 1}`, resposta: `${item.nome} - ${item.mandado}` });
							}
						});
					}
					if (p.tipo === 'armas_complex' && resps.armas_detalhe) {
						Object.entries(resps.armas_detalhe).forEach(([tipo, qtd]) => {
							if (Number(qtd) > 0) {
								allResults.push({ equipe_id: eqId, pergunta: `  ↳ Arma: ${tipo}`, resposta: `${qtd}` });
							}
						});
					}
					if (p.tipo === 'apreensoes_menores' && resps.apreensoes_lista) {
						resps.apreensoes_lista.forEach((item: any, idx: number) => {
							if (item.nome || item.mandado) {
								allResults.push({ equipe_id: eqId, pergunta: `  ↳ Apreensão ${idx + 1}`, resposta: `${item.nome} - ${item.mandado}` });
							}
						});
					}
					if (p.tipo === 'drogas_complex' && resps.drogas_selecionadas) {
						resps.drogas_selecionadas.forEach((d: string) => {
							const peso = resps.drogas_detalhe?.[d] || '0';
							const unid = resps.drogas_unidade?.[d] || 'g';
							allResults.push({ equipe_id: eqId, pergunta: `  ↳ Droga: ${d}`, resposta: `${peso}${unid}` });
						});
					}
					// SEINT Complex Types
					if (p.tipo === 'celulares_complex' && resps.celulares_lista) {
						resps.celulares_lista.forEach((item: any, idx: number) => {
							if (item.modelo || item.n_proc) {
								allResults.push({ equipe_id: eqId, pergunta: `  ↳ Aparelho ${idx + 1}`, resposta: `${item.modelo || ''} ${item.n_proc ? '(Proc: ' + item.n_proc + ')' : ''}`.trim() });
							}
						});
					}
					if (p.tipo === 'analise_complex' && resps.analise_lista) {
						resps.analise_lista.forEach((item: any, idx: number) => {
							if (item.modelo || item.n_proc) {
								allResults.push({ equipe_id: eqId, pergunta: `  ↳ Análise ${idx + 1}`, resposta: `${item.modelo || ''} ${item.tamanho ? '[' + item.tamanho + ']' : ''} ${item.n_proc ? '(Proc: ' + item.n_proc + ')' : ''}`.trim() });
							}
						});
					}
					if (p.tipo === 'relatorios_seint_complex' && resps.relatorios_seint_lista) {
						resps.relatorios_seint_lista.forEach((item: any, idx: number) => {
							if (item.n_relat || item.q_alvos) {
								allResults.push({ equipe_id: eqId, pergunta: `  ↳ Relatório ${idx + 1}`, resposta: `${item.n_relat || ''} ${item.q_alvos ? '(' + item.q_alvos + ' alvos)' : ''}`.trim() });
							}
						});
					}
					if (p.tipo === 'foragidos_complex' && resps.foragidos_lista) {
						resps.foragidos_lista.forEach((item: any, idx: number) => {
							if (item.nome || item.resultado) {
								allResults.push({ equipe_id: eqId, pergunta: `  ↳ Alvo ${idx + 1}`, resposta: `${item.nome || ''} - Status: ${item.resultado || 'N/I'}`.trim() });
							}
						});
					}
					if ((p.tipo === 'operacoes_seint_complex' || p.tipo === 'operacoes_seint_pura') && resps.operacoes_seint_lista) {
						resps.operacoes_seint_lista.forEach((item: any, idx: number) => {
							if (item.nome || item.delegacia) {
								allResults.push({ equipe_id: eqId, pergunta: `  ↳ Operação ${idx + 1}`, resposta: `${item.nome || ''} (${item.delegacia || ''})`.trim() });
							}
						});
					}

					if (p.filhos && p.filhos.length > 0) {
						processarPerguntas(p.filhos, resps, eqId);
					}
				}
			}
		}
	};

	for (const r of rows) {
		let resps: any;
		try {
			resps = JSON.parse(r.respostas);
		} catch {
			continue;
		}

		const modeloPerguntas = modelosMap.get(r.equipe_tipo) ||
			(r.equipe_tipo === 'seint' ? DEFAULT_SEINT_QUESTIONS : DEFAULT_QUESTIONS);

		processarPerguntas(modeloPerguntas, resps, r.equipe_id!);
	}

	return allResults;
}

// ---- Documentos GISE ----

export async function salvarGiseDocumento(
	db: Database,
	giseId: number,
	r2Key: string,
	assinanteId: number,
	assinanteNome: string,
	assinanteCpf: string,
	verificacaoHash: string,
	rubrica?: string,
	ipAddress?: string,
	userAgent?: string,
	latitude?: number,
	longitude?: number,
	selfieKey?: string,
	arquivoHash?: string,
	assinanteEmail?: string,
	tipoCarimboTempo?: string
) {
	return db
		.insert(giseDocumentos)
		.values({
			gise_id: giseId,
			r2_key: r2Key,
			assinante_id: assinanteId,
			assinante_nome: assinanteNome,
			assinante_cpf: assinanteCpf,
			assinante_email: assinanteEmail ?? null,
			verificacao_hash: verificacaoHash,
			selfie_key: selfieKey,
			arquivo_hash: arquivoHash,
			rubrica: rubrica || null,
			ip_address: ipAddress,
			user_agent: userAgent,
			latitude,
			longitude,
			tipo_carimbo_tempo: tipoCarimboTempo || 'servidor'
		})
		.onConflictDoUpdate({
			target: [giseDocumentos.gise_id],
			set: {
				r2_key: r2Key,
				assinante_id: assinanteId,
				assinante_nome: assinanteNome,
				assinante_cpf: assinanteCpf,
				assinante_email: assinanteEmail ?? null,
				verificacao_hash: verificacaoHash,
				selfie_key: selfieKey,
				arquivo_hash: arquivoHash,
				rubrica: rubrica || null,
				ip_address: ipAddress,
				user_agent: userAgent,
				latitude,
				longitude,
				tipo_carimbo_tempo: tipoCarimboTempo || 'servidor',
				created_at: sql`datetime('now', '-3 hours')`
			}
		});
}

export async function buscarGiseDocumento(
	db: Database,
	giseId: number
): Promise<schema.GiseDocumento | undefined> {
	return db.select().from(giseDocumentos).where(eq(giseDocumentos.gise_id, giseId)).get();
}

// ---- Verificações de contexto ----

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

// ---- Formulário modelo ----

export async function buscarGiseModeloFormulario(db: Database, tipo: 'operacional' | 'seint' = 'operacional') {
	try {
		return db.select().from(giseModeloFormulario).where(eq(giseModeloFormulario.tipo, tipo)).get();
	} catch (e) {
		logger.error('Erro ao buscar modelo GISE — migration 0042 pode não ter sido aplicada', { tipo, err: String(e) });
		return null;
	}
}

export async function salvarGiseModeloFormulario(db: Database, tipo: 'operacional' | 'seint', config: string) {
	const existente = await db.select({ id: giseModeloFormulario.id })
		.from(giseModeloFormulario)
		.where(eq(giseModeloFormulario.tipo, tipo))
		.get();

	if (existente) {
		return db
			.update(giseModeloFormulario)
			.set({ config, updated_at: sql`datetime('now', '-3 hours')` })
			.where(eq(giseModeloFormulario.id, existente.id));
	}

	return db
		.insert(giseModeloFormulario)
		.values({ tipo, config, updated_at: sql`datetime('now', '-3 hours')` });
}

// ---- Respostas ----

export async function buscarRespostaGise(
	db: Database,
	giseId: number,
	policialId: number | null,
	equipeId?: number
) {
	let targetEquipeId = equipeId;

	if (!targetEquipeId && policialId) {
		const meuMembro = await db
			.select({ equipe_id: giseMembros.equipe_id })
			.from(giseMembros)
			.where(eq(giseMembros.policial_id, policialId))
			.get();
		if (!meuMembro) return null;
		targetEquipeId = meuMembro.equipe_id;
	}

	if (!targetEquipeId) return null;

	return db
		.select()
		.from(giseRespostasFormulario)
		.where(
			and(
				eq(giseRespostasFormulario.gise_id, giseId),
				eq(giseRespostasFormulario.equipe_id, targetEquipeId)
			)
		)
		.get();
}

export async function salvarRespostaGise(
	db: Database,
	giseId: number,
	policialId: number,
	respostas: string,
	equipeId?: number
) {
	const existente = await buscarRespostaGise(db, giseId, policialId, equipeId);

	if (existente) {
		const targetId = existente.id;
		return db
			.update(giseRespostasFormulario)
			.set({ respostas, updated_at: sql`datetime('now', '-3 hours')` })
			.where(eq(giseRespostasFormulario.id, targetId));
	}

	return db.insert(giseRespostasFormulario).values({
		gise_id: giseId,
		policial_id: policialId,
		equipe_id: equipeId ?? null,
		respostas,
		updated_at: sql`datetime('now', '-3 hours')`
	});
}

export async function listarTodasRespostasGise(
	db: Database,
	opts?: { page?: number; limit?: number; mes?: number; ano?: number }
): Promise<{
	respostas: Array<{
		id: number;
		gise_id: number;
		policial_id: number;
		respostas: string;
		updated_at: string;
		data_inicio: string;
		seccional_id: number;
		seccional_nome: string;
		equipe_id: number;
		equipe_tipo: string;
	}>;
	total: number;
	page: number;
	limit: number;
	totalPages: number;
}> {
	const page = Math.max(1, opts?.page ?? 1);
	const limit = Math.min(500, Math.max(1, opts?.limit ?? 200));
	const offset = (page - 1) * limit;

	// Build dynamic conditions
	const conditions: any[] = [];
	if (opts?.mes) {
		const monthStr = opts.mes.toString().padStart(2, '0');
		conditions.push(sql`strftime('%m', ${giseEscalas.data_inicio}) = ${monthStr}`);
	}
	if (opts?.ano) {
		conditions.push(sql`strftime('%Y', ${giseEscalas.data_inicio}) = ${opts.ano.toString()}`);
	}
	const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

	// Count total
	const countResult = await db
		.select({ count: sql<number>`count(*)` })
		.from(giseRespostasFormulario)
		.innerJoin(giseEquipes, eq(giseRespostasFormulario.equipe_id, giseEquipes.id))
		.innerJoin(giseSeccionais, eq(giseEquipes.gise_seccional_id, giseSeccionais.id))
		.innerJoin(giseEscalas, eq(giseSeccionais.gise_id, giseEscalas.id))
		.where(whereClause)
		.get();
	const total = Number(countResult?.count ?? 0);
	const totalPages = Math.ceil(total / limit);

	const resultados = await db
		.select({
			id: giseRespostasFormulario.id,
			gise_id: giseRespostasFormulario.gise_id,
			policial_id: giseRespostasFormulario.policial_id,
			respostas: giseRespostasFormulario.respostas,
			updated_at: giseRespostasFormulario.updated_at,
			data_inicio: giseEscalas.data_inicio,
			seccional_id: giseSeccionais.seccional_id,
			seccional_nome: unidades.nome,
			equipe_id: giseEquipes.id,
			equipe_tipo: giseEquipes.tipo
		})
		.from(giseRespostasFormulario)
		.innerJoin(giseEquipes, eq(giseRespostasFormulario.equipe_id, giseEquipes.id))
		.innerJoin(giseSeccionais, eq(giseEquipes.gise_seccional_id, giseSeccionais.id))
		.innerJoin(unidades, eq(giseSeccionais.seccional_id, unidades.id))
		.innerJoin(giseEscalas, eq(giseSeccionais.gise_id, giseEscalas.id))
		.where(whereClause)
		.orderBy(desc(giseEscalas.data_inicio))
		.limit(limit)
		.offset(offset);

	return { respostas: resultados, total, page, limit, totalPages };
}

// ---- Presenças ----

export async function buscarPresencaGise(db: Database, giseId: number, policialId: number) {
	return db
		.select()
		.from(gisePresencas)
		.where(and(eq(gisePresencas.gise_id, giseId), eq(gisePresencas.policial_id, policialId)))
		.get();
}

export async function salvarEntradaGise(
	db: Database,
	giseId: number,
	policialId: number,
	rubrica: string,
	ipAddress?: string,
	userAgent?: string,
	latitude?: number,
	longitude?: number,
	selfieKey?: string
) {
	const now = getNowBR().toISOString();
	return db
		.insert(gisePresencas)
		.values({
			gise_id: giseId,
			policial_id: policialId,
			entrada_timestamp: now,
			entrada_rubrica: rubrica,
			entrada_selfie_key: selfieKey,
			ip_address: ipAddress,
			user_agent: userAgent,
			latitude,
			longitude,
			updated_at: sql`datetime('now', '-3 hours')`
		})
		.onConflictDoUpdate({
			target: [gisePresencas.gise_id, gisePresencas.policial_id],
			set: {
				entrada_timestamp: now,
				entrada_rubrica: rubrica,
				entrada_selfie_key: selfieKey,
				ip_address: ipAddress,
				user_agent: userAgent,
				latitude,
				longitude,
				updated_at: sql`datetime('now', '-3 hours')`
			}
		});
}

export async function salvarSaidaGise(
	db: Database,
	giseId: number,
	policialId: number,
	rubrica: string,
	ipAddress?: string,
	userAgent?: string,
	latitude?: number,
	longitude?: number,
	selfieKey?: string
) {
	return db
		.update(gisePresencas)
		.set({
			saida_timestamp: getNowBR().toISOString(),
			saida_rubrica: rubrica,
			saida_selfie_key: selfieKey,
			ip_address: ipAddress,
			user_agent: userAgent,
			latitude,
			longitude,
			updated_at: sql`datetime('now', '-3 hours')`
		})
		.where(and(eq(gisePresencas.gise_id, giseId), eq(gisePresencas.policial_id, policialId)));
}

export async function isDailyGiseSigned(db: Database, giseId: number) {
	const doc = await db
		.select({ id: giseDocumentos.id })
		.from(giseDocumentos)
		.where(eq(giseDocumentos.gise_id, giseId))
		.get();
	return !!doc;
}

export async function buscarPresencasGise(db: Database, giseId: number) {
	return db
		.select({
			id: gisePresencas.id,
			gise_id: gisePresencas.gise_id,
			policial_id: gisePresencas.policial_id,
			policial_nome: policiais.nome,
			policial_matricula: policiais.matricula,
			policial_cpf: policiais.cpf,
			entrada_timestamp: gisePresencas.entrada_timestamp,
			entrada_rubrica: gisePresencas.entrada_rubrica,
			entrada_selfie_key: gisePresencas.entrada_selfie_key,
			saida_timestamp: gisePresencas.saida_timestamp,
			saida_rubrica: gisePresencas.saida_rubrica,
			saida_selfie_key: gisePresencas.saida_selfie_key,
			ip_address: gisePresencas.ip_address,
			user_agent: gisePresencas.user_agent,
			latitude: gisePresencas.latitude,
			longitude: gisePresencas.longitude
		})
		.from(gisePresencas)
		.innerJoin(policiais, eq(gisePresencas.policial_id, policiais.id))
		.where(eq(gisePresencas.gise_id, giseId))
		.all();
}

// ---- Assinaturas de Relatórios ----

export async function buscarAssinaturasRelatoriosGise(db: Database, giseId: number) {
	return db
		.select()
		.from(giseAssinaturasRelatorios)
		.where(eq(giseAssinaturasRelatorios.gise_id, giseId))
		.all();
}

export async function buscarAssinaturaRelatorioGise(
	db: Database,
	giseId: number,
	seccionalId: number,
	tipo: 'extraordinario' | 'produtividade'
) {
	return db
		.select({
			id: giseAssinaturasRelatorios.id,
			gise_id: giseAssinaturasRelatorios.gise_id,
			seccional_id: giseAssinaturasRelatorios.seccional_id,
			tipo: giseAssinaturasRelatorios.tipo,
			assinante_id: giseAssinaturasRelatorios.assinante_id,
			assinante_nome: giseAssinaturasRelatorios.assinante_nome,
			assinante_cpf: giseAssinaturasRelatorios.assinante_cpf,
			assinante_matricula: policiais.matricula,
			tipo_assinatura: giseAssinaturasRelatorios.tipo_assinatura,
			rubrica: giseAssinaturasRelatorios.rubrica,
			verification_hash: giseAssinaturasRelatorios.verification_hash,
			selfie_key: giseAssinaturasRelatorios.selfie_key,
			ip_address: giseAssinaturasRelatorios.ip_address,
			user_agent: giseAssinaturasRelatorios.user_agent,
			latitude: giseAssinaturasRelatorios.latitude,
			longitude: giseAssinaturasRelatorios.longitude,
			r2_key: giseAssinaturasRelatorios.r2_key,
			created_at: giseAssinaturasRelatorios.created_at
		})
		.from(giseAssinaturasRelatorios)
		.leftJoin(policiais, eq(giseAssinaturasRelatorios.assinante_id, policiais.id))
		.where(
			and(
				eq(giseAssinaturasRelatorios.gise_id, giseId),
				eq(giseAssinaturasRelatorios.seccional_id, seccionalId),
				eq(giseAssinaturasRelatorios.tipo, tipo)
			)
		)
		.orderBy(desc(giseAssinaturasRelatorios.created_at))
		.get();
}

export async function salvarAssinaturaRelatorioGise(
	db: Database,
	data: {
		gise_id: number;
		seccional_id: number;
		tipo: 'extraordinario' | 'produtividade';
		assinante_id?: number | null;
		assinante_nome: string;
		assinante_cpf?: string | null;
		tipo_assinatura: 'simples' | 'webpki' | 'serpro';
		rubrica?: string;
		verification_hash?: string;
		ip_address?: string;
		user_agent?: string;
		latitude?: number;
		longitude?: number;
		selfie_key?: string;
		arquivo_hash?: string;
		r2_key?: string | null;
		assinante_email?: string | null;
		tipo_carimbo_tempo?: string;
	}
) {
	return db
		.insert(giseAssinaturasRelatorios)
		.values({ ...data, assinante_id: data.assinante_id ?? null, assinante_cpf: data.assinante_cpf ?? '' })
		.onConflictDoUpdate({
			target: [
				giseAssinaturasRelatorios.gise_id,
				giseAssinaturasRelatorios.seccional_id,
				giseAssinaturasRelatorios.tipo
			],
			set: {
				assinante_id: data.assinante_id ?? null,
				assinante_nome: data.assinante_nome,
				assinante_cpf: data.assinante_cpf ?? '',
				tipo_assinatura: data.tipo_assinatura,
				rubrica: data.rubrica,
				verification_hash: data.verification_hash,
				ip_address: data.ip_address,
				user_agent: data.user_agent,
				latitude: data.latitude,
				longitude: data.longitude,
				selfie_key: data.selfie_key,
				arquivo_hash: data.arquivo_hash,
				r2_key: data.r2_key,
				assinante_email: data.assinante_email ?? null,
				tipo_carimbo_tempo: data.tipo_carimbo_tempo || 'servidor',
				created_at: sql`datetime('now', '-3 hours')`
			}
		});
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

// ---- Slots de unidade por seccional ----

/**
 * Adiciona um slot de unidade à seccional e cria uma equipe operacional padrão vinculada ao slot.
 * unidadeId pode ser null quando o Adm Geral quer criar um slot em branco
 * para o Adm Seccional preencher depois.
 */
export async function adicionarGiseSeccionalUnidade(
	db: Database,
	giseSeccionalId: number,
	unidadeId: number | null
): Promise<number> {
	const [result] = await db
		.insert(giseSeccionalUnidades)
		.values({ gise_seccional_id: giseSeccionalId, unidade_id: unidadeId })
		.returning({ id: giseSeccionalUnidades.id });

	// Equipe operacional padrão vinculada ao slot
	await db.insert(giseEquipes).values({
		gise_seccional_id: giseSeccionalId,
		gise_unidade_id: result.id,
		tipo: 'operacional',
		slots_dpc: 1,
		slots_oip: 3
	});

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
