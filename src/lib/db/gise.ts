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
	policiais,
	unidades
} from '../server/schema';
import { getNowBR } from '../utils';
import type * as schema from '../server/schema';
import type { Database } from './core';

// ---- Tipos ----

export interface GiseDetalhado extends schema.GiseEscala {
	seccionais: Array<
		schema.GiseSeccional & {
			seccional_nome: string;
			unidade_operacional_nome: string | null;
			temRespostas: boolean;
			equipes: Array<
				schema.GiseEquipe & {
					membros: Array<
						schema.GiseMembro & {
							policial_nome: string;
							policial_cargo: string;
							policial_matricula: string;
							policial_telefone: string | null;
							policial_lotacao: string | null;
							policial_classe: string | null;
							presenca: schema.GisePresenca | null;
						}
					>;
				}
			>;
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
	let query = db.select().from(giseEscalas);

	if (supervisorId) {
		query = query.where(eq(giseEscalas.supervisor_id, supervisorId)) as any;
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
		) as any;
	}

	const escalas = await query.orderBy(desc(giseEscalas.data_inicio)).all();
	if (escalas.length === 0) return [];

	const escalaIds = escalas.map(e => e.id);

	// Batch all related data in parallel instead of N+1 per escala
	const [saidasRows, secCountRows, assExtraRows, membroSecRows] = await Promise.all([
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
			: Promise.resolve([])
	]);

	// Build lookup maps for O(1) access
	const saidasSet = new Set(saidasRows.map(r => r.gise_id));
	const secCountMap = new Map(secCountRows.map(r => [r.gise_id, r.count]));
	const assExtraMap = new Map(assExtraRows.map(r => [r.gise_id, r.count]));
	const membroSecMap = new Map((membroSecRows as Array<{ gise_id: number; seccional_id: number }>).map(r => [r.gise_id, r.seccional_id]));

	return escalas.map(e => ({
		...e,
		temSaidaConfirmada: saidasSet.has(e.id),
		totalSeccionais: secCountMap.get(e.id) ?? 0,
		assinaturasRelatorioExtra: assExtraMap.get(e.id) ?? 0,
		policialSeccionalId: membroSecMap.get(e.id) ?? null
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
		todasRespostas
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
			.where(eq(giseRespostasFormulario.gise_id, id))
	]);

	const supervisor_nome = supervisorRow?.nome ?? null;
	const supervisor_matricula = supervisorRow?.matricula ?? null;

	const assExtraRow = await db
		.select({ count: sql<number>`count(*)` })
		.from(giseAssinaturasRelatorios)
		.where(
			and(
				eq(giseAssinaturasRelatorios.gise_id, id),
				eq(giseAssinaturasRelatorios.tipo, 'extraordinario')
			)
		)
		.get();

	const temSaidaConfirmada = todasPresencas.some((p) => p.saida_timestamp !== null);

	// Índices em memória para lookups O(1)
	const presencaMap = new Map(todasPresencas.map((p) => [p.policial_id, p]));
	const seccionalComRespostas = new Set(todasRespostas.map((r) => r.equipe_seccional_id));

	const equipesPorSeccional = new Map<number, typeof todasEquipes>();
	for (const row of todasEquipes) {
		const secId = row.gise_seccionais.id;
		if (!equipesPorSeccional.has(secId)) equipesPorSeccional.set(secId, []);
		equipesPorSeccional.get(secId)!.push(row);
	}

	const membrosPorEquipe = new Map<number, typeof todosMembros>();
	for (const m of todosMembros) {
		if (!membrosPorEquipe.has(m.equipe_id)) membrosPorEquipe.set(m.equipe_id, []);
		membrosPorEquipe.get(m.equipe_id)!.push(m);
	}

	// Carrega nomes de unidades operacionais em lote
	const uoIds = [
		...new Set(
			secsRows.map((s) => s.unidade_operacional_id).filter(Boolean) as number[]
		)
	];
	const uoNomes = new Map<number, string>();
	if (uoIds.length > 0) {
		const uoRows = await db
			.select({ id: unidades.id, nome: unidades.nome })
			.from(unidades)
			.where(inArray(unidades.id, uoIds));
		for (const u of uoRows) uoNomes.set(u.id, u.nome);
	}

	const seccionais = secsRows.map((sec) => {
		const equipesRaw = equipesPorSeccional.get(sec.id) ?? [];
		const equipes = equipesRaw.map((row) => {
			const equipe = row.gise_equipes;
			const membrosRaw = membrosPorEquipe.get(equipe.id) ?? [];
			const membros = membrosRaw.map((m) => ({
				...m,
				presenca: presencaMap.get(m.policial_id) ?? null
			}));
			return { ...equipe, membros };
		});

		return {
			...sec,
			unidade_operacional_nome: sec.unidade_operacional_id
				? (uoNomes.get(sec.unidade_operacional_id) ?? null)
				: null,
			equipes,
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

	await db.insert(giseEquipes).values([
		{ gise_seccional_id: secId, tipo: 'operacional', slots_dpc: 1, slots_oip: 3 },
		{ gise_seccional_id: secId, tipo: 'seint', slots_dpc: 0, slots_oip: 2 }
	]);

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
	slots_oip: number
) {
	const result = await db
		.insert(giseEquipes)
		.values({ gise_seccional_id: giseSeccionalId, tipo, slots_dpc, slots_oip })
		.returning({ id: giseEquipes.id });
	return result[0].id;
}

export async function reabrirGiseEscala(db: Database, giseId: number) {
	await db.delete(giseDocumentos).where(eq(giseDocumentos.gise_id, giseId));
	await atualizarGiseEscala(db, giseId, { status: 'em_preenchimento' });
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
 */
export async function verificarTodosSairam(db: Database, giseId: number): Promise<boolean> {
	// Total de membros escalados na GISE
	const totalMembros = await db
		.select({ count: sql<number>`count(*)` })
		.from(giseMembros)
		.innerJoin(giseEquipes, eq(giseMembros.equipe_id, giseEquipes.id))
		.innerJoin(giseSeccionais, eq(giseEquipes.gise_seccional_id, giseSeccionais.id))
		.where(eq(giseSeccionais.gise_id, giseId))
		.get();

	if (!totalMembros || totalMembros.count === 0) return false;

	// Total com saída confirmada
	const comSaida = await db
		.select({ count: sql<number>`count(*)` })
		.from(gisePresencas)
		.where(and(eq(gisePresencas.gise_id, giseId), isNotNull(gisePresencas.saida_timestamp)))
		.get();

	return (comSaida?.count ?? 0) >= totalMembros.count;
}

/**
 * Verifica se todas as equipes enviaram seus relatórios de produtividade.
 */
export async function verificarTodosRelatoriosEnviados(db: Database, giseId: number): Promise<boolean> {
	// Total de equipes na GISE
	const totalEquipes = await db
		.select({ count: sql<number>`count(*)` })
		.from(giseEquipes)
		.innerJoin(giseSeccionais, eq(giseEquipes.gise_seccional_id, giseSeccionais.id))
		.where(eq(giseSeccionais.gise_id, giseId))
		.get();

	if (!totalEquipes || totalEquipes.count === 0) return false;

	// Total de equipes com resposta enviada
	const comResposta = await db
		.select({ count: sql<number>`count(distinct ${giseRespostasFormulario.equipe_id})` })
		.from(giseRespostasFormulario)
		.where(eq(giseRespostasFormulario.gise_id, giseId))
		.get();

	return (comResposta?.count ?? 0) >= totalEquipes.count;
}

/**
 * Verifica se todos os relatórios de extra estão assinados (uma por seccional).
 */
export async function verificarTodosRelatoriosExtraAssinados(db: Database, giseId: number): Promise<boolean> {
	const totalSeccionais = await db
		.select({ count: sql<number>`count(*)` })
		.from(giseSeccionais)
		.where(eq(giseSeccionais.gise_id, giseId))
		.get();

	if (!totalSeccionais || totalSeccionais.count === 0) return false;

	const totalAssinadas = await db
		.select({ count: sql<number>`count(*)` })
		.from(giseAssinaturasRelatorios)
		.where(
			and(
				eq(giseAssinaturasRelatorios.gise_id, giseId),
				eq(giseAssinaturasRelatorios.tipo, 'extraordinario')
			)
		)
		.get();

	return (totalAssinadas?.count ?? 0) >= totalSeccionais.count;
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
		secsParaClonar = await db.select().from(giseSeccionais).where(eq(giseSeccionais.gise_id, giseId));
	} else {
		const todas = await db.select().from(unidades).where(eq(unidades.tipo, 'seccional')).all();
		secsParaClonar = todas.map((s) => ({ seccional_id: s.id }));
	}

	for (const sec of secsParaClonar) {
		const novaSecResult = await db
			.insert(giseSeccionais)
			.values({
				gise_id: novoId,
				seccional_id: sec.seccional_id,
				unidade_operacional_id: null,
				status: 'pendente'
			})
			.returning({ id: giseSeccionais.id });
		const novaSecId = novaSecResult[0].id;

		let equipesOriginais: any[] = [];
		if (modo === 'clonada' && sec.id) {
			equipesOriginais = await db
				.select()
				.from(giseEquipes)
				.where(eq(giseEquipes.gise_seccional_id, sec.id));
		}

		if (equipesOriginais.length > 0) {
			await db.insert(giseEquipes).values(
				equipesOriginais.map((eq_: any) => ({
					gise_seccional_id: novaSecId,
					tipo: eq_.tipo,
					slots_dpc: eq_.slots_dpc,
					slots_oip: eq_.slots_oip
				}))
			);
		} else {
			await db.insert(giseEquipes).values([
				{ gise_seccional_id: novaSecId, tipo: 'operacional', slots_dpc: 1, slots_oip: 3 },
				{ gise_seccional_id: novaSecId, tipo: 'seint', slots_dpc: 0, slots_oip: 2 }
			]);
		}
	}

	return novoId;
}

export async function verificarSlotEquipe(
	db: Database,
	equipeId: number,
	policialId: number
): Promise<{ ok: boolean; motivo?: string }> {
	const equipe = await db.select().from(giseEquipes).where(eq(giseEquipes.id, equipeId)).get();
	if (!equipe) return { ok: false, motivo: 'Equipe não encontrada' };

	const policial = await db
		.select({ cargo: policiais.cargo })
		.from(policiais)
		.where(eq(policiais.id, policialId))
		.get();
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

export async function buscarRespostasProdutividadeSeccional(
	db: any,
	giseId: number,
	seccionalId: number
) {
	const configRow = await db.select().from(giseModeloFormulario).get();
	let modeloPerguntas: any[];
	try {
		modeloPerguntas = configRow ? JSON.parse(configRow.config) : DEFAULT_QUESTIONS;
	} catch {
		modeloPerguntas = DEFAULT_QUESTIONS;
	}

	const rows = await db
		.select({ equipe_id: giseRespostasFormulario.equipe_id, respostas: giseRespostasFormulario.respostas })
		.from(giseRespostasFormulario)
		.innerJoin(giseEquipes, eq(giseRespostasFormulario.equipe_id, giseEquipes.id))
		.where(
			and(
				eq(giseRespostasFormulario.gise_id, giseId),
				eq(giseEquipes.gise_seccional_id, seccionalId)
			)
		)
		.all();

	const allResults: { equipe_id: number; pergunta: string; resposta: string }[] = [];

	const processarPerguntas = (listaPerguntas: any[], resps: any, eqId: number) => {
		for (const p of listaPerguntas) {
			const resp = resps[p.key] ?? resps[String(p.id)] ?? resps[p.id];
			if (resp !== undefined && resp !== null && resp !== '') {
				allResults.push({ equipe_id: eqId, pergunta: p.texto, resposta: String(resp) });

				if (resp === 'Sim') {
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
	arquivoHash?: string
) {
	return db
		.insert(giseDocumentos)
		.values({
			gise_id: giseId,
			r2_key: r2Key,
			assinante_id: assinanteId,
			assinante_nome: assinanteNome,
			assinante_cpf: assinanteCpf,
			verificacao_hash: verificacaoHash,
			selfie_key: selfieKey,
			arquivo_hash: arquivoHash,
			rubrica: rubrica || null,
			ip_address: ipAddress,
			user_agent: userAgent,
			latitude,
			longitude
		})
		.onConflictDoUpdate({
			target: [giseDocumentos.gise_id],
			set: {
				r2_key: r2Key,
				assinante_id: assinanteId,
				assinante_nome: assinanteNome,
				assinante_cpf: assinanteCpf,
				verificacao_hash: verificacaoHash,
				selfie_key: selfieKey,
				arquivo_hash: arquivoHash,
				rubrica: rubrica || null,
				ip_address: ipAddress,
				user_agent: userAgent,
				latitude,
				longitude,
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

export async function buscarGiseModeloFormulario(db: Database) {
	return db.select().from(giseModeloFormulario).where(eq(giseModeloFormulario.id, 1)).get();
}

export async function salvarGiseModeloFormulario(db: Database, config: string) {
	return db
		.insert(giseModeloFormulario)
		.values({ id: 1, config, updated_at: sql`datetime('now')` })
		.onConflictDoUpdate({
			target: [giseModeloFormulario.id],
			set: { config, updated_at: sql`datetime('now', '-3 hours')` }
		});
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
		const targetId = (existente as any).id;
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

export async function listarTodasRespostasGise(db: Database) {
	return db
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
		.all();
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
