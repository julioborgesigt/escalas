/**
 * As duas LEITURAS grandes da GISE: a listagem (`listarGiseEscalas`) e o
 * carregamento completo de uma (`buscarGiseDetalhado`). Separadas do
 * `escalas-crud` porque o que dói aqui não é a regra, é o número de queries —
 * uma GISE tem seccionais → equipes → membros → presenças, e a versão ingênua
 * é N+1 em quatro níveis.
 *
 * A saída é uma query por NÍVEL, todas disparadas juntas num `Promise.all` e
 * costuradas em memória — cada uma puxa o nível inteiro com `inArray(ids)` e
 * usa join só para alcançar as tabelas vizinhas. Não existe um join único de
 * tudo, de propósito: ele produziria o produto cartesiano de presenças ×
 * membros. Ao acrescentar um nível, siga o mesmo formato, nunca um `.get()`
 * dentro de `map` — o D1 cobra por round-trip.
 *
 * A listagem NÃO é uma tabela: é um filtro de VISIBILIDADE. Os vínculos
 * (supervisor, participante do quadro ou de equipe, admin de seccional
 * participante) combinam por OR, e ausência de filtro significa "todas" — o
 * caso do Admin Geral e do export. Passar o filtro errado aqui não dá erro, só
 * mostra GISE de quem não devia ver.
 */
import { eq, and, or, ne, isNotNull, desc, asc, inArray, sql, type SQL } from 'drizzle-orm';
import {
	giseEscalas,
	giseSeccionais,
	giseEquipes,
	giseMembros,
	giseDocumentos,
	gisePresencas,
	giseRespostasFormulario,
	giseAssinaturasRelatorios,
	giseSeccionalUnidades,
	policiais,
	unidades
} from '../../server/schema';
import type { Database } from '../core';
import { logger } from '../../server/logger';
import type { GiseDetalhado, GiseUnidadeSlot } from './types';
import { buscarUnidadeIdSupervisaoExtra } from '../../server/gise-supervisao-extra';

/**
 * GISEs visíveis para quem pede, com os agregados que a listagem mostra.
 *
 * Os três filtros são VÍNCULOS, combinados por OR: supervisor, participante
 * (quadro de supervisão ou membro de equipe) e admin de seccional participante.
 * Nenhum filtro = todas as GISEs, que é o caso do Admin Geral e do export
 * administrativo — então omitir os parâmetros é escolha de escopo, não descuido:
 * chamar sem argumentos entrega o sistema inteiro.
 */
export async function listarGiseEscalas(
	db: Database,
	supervisorId?: number,
	policialId?: number,
	seccionalParticipanteId?: number
) {
	let query = db.select().from(giseEscalas).$dynamic();

	// União de vínculos: cada filtro fornecido vira uma condição OR. Sem nenhum
	// filtro (todos undefined) → sem WHERE → todas as GISEs (uso do admin geral
	// e do export administrativo).
	const conds: SQL[] = [];
	if (supervisorId) {
		conds.push(eq(giseEscalas.supervisor_id, supervisorId));
	}
	if (policialId) {
		// GISEs onde o policial é quadro de supervisão OU membro de equipe.
		conds.push(
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
		);
	}
	if (seccionalParticipanteId) {
		// GISEs que incluem a seccional/unidade administrada (escopo Opção B).
		conds.push(
			sql`EXISTS (
				SELECT 1 FROM ${giseSeccionais} s
				WHERE s.gise_id = ${giseEscalas.id}
					AND (s.seccional_id = ${seccionalParticipanteId} OR s.unidade_operacional_id = ${seccionalParticipanteId})
			)`
		);
	}
	if (conds.length > 0) {
		query = query.where(or(...conds));
	}

	const escalas = await query.orderBy(desc(giseEscalas.data_inicio), desc(giseEscalas.id)).all();
	if (escalas.length === 0) return [];

	const escalaIds = escalas.map((e) => e.id);

	// Batch all related data in parallel instead of N+1 per escala
	const parallelResults = await Promise.all([
		db
			.select({ gise_id: gisePresencas.gise_id })
			.from(gisePresencas)
			.where(
				and(inArray(gisePresencas.gise_id, escalaIds), isNotNull(gisePresencas.saida_timestamp))
			)
			.all(),
		db
			.select({ gise_id: giseSeccionais.gise_id, count: sql<number>`count(*)` })
			.from(giseSeccionais)
			.where(inArray(giseSeccionais.gise_id, escalaIds))
			.groupBy(giseSeccionais.gise_id)
			.all(),
		db
			.select({
				gise_id: giseAssinaturasRelatorios.gise_id,
				seccional_id: giseAssinaturasRelatorios.seccional_id
			})
			.from(giseAssinaturasRelatorios)
			.where(
				and(
					inArray(giseAssinaturasRelatorios.gise_id, escalaIds),
					eq(giseAssinaturasRelatorios.tipo, 'extraordinario')
				)
			)
			.all(),
		buscarUnidadeIdSupervisaoExtra(db),
		policialId
			? db
					.select({ gise_id: giseSeccionais.gise_id, seccional_id: giseSeccionais.seccional_id })
					.from(giseMembros)
					.innerJoin(giseEquipes, eq(giseMembros.equipe_id, giseEquipes.id))
					.innerJoin(giseSeccionais, eq(giseEquipes.gise_seccional_id, giseSeccionais.id))
					.where(
						and(inArray(giseSeccionais.gise_id, escalaIds), eq(giseMembros.policial_id, policialId))
					)
					.all()
			: Promise.resolve([]),
		db
			.select({
				gise_id: giseSeccionais.gise_id,
				seccional_id: giseSeccionais.seccional_id,
				nome: unidades.nome
			})
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
			.all(),
		// IDs das seccionais cujo relatório de extra está PRONTO para assinar:
		// TODOS os membros confirmaram a saída (rubrica) e o extra ainda não foi
		// assinado. O `having count(*) = count(saida_timestamp)` exige saída de
		// todos (left join: membro sem presença/sem saída deixa o count menor).
		db
			.select({ gise_id: giseSeccionais.gise_id, seccional_id: giseSeccionais.seccional_id })
			.from(giseSeccionais)
			.innerJoin(giseEquipes, eq(giseEquipes.gise_seccional_id, giseSeccionais.id))
			.innerJoin(giseMembros, eq(giseMembros.equipe_id, giseEquipes.id))
			.leftJoin(
				gisePresencas,
				and(
					eq(gisePresencas.policial_id, giseMembros.policial_id),
					eq(gisePresencas.gise_id, giseSeccionais.gise_id)
				)
			)
			.where(
				and(
					inArray(giseSeccionais.gise_id, escalaIds),
					sql`NOT EXISTS (
						SELECT 1 FROM gise_assinaturas_relatorios
						WHERE gise_assinaturas_relatorios.gise_id = ${giseSeccionais.gise_id}
						AND gise_assinaturas_relatorios.seccional_id = ${giseSeccionais.seccional_id}
						AND gise_assinaturas_relatorios.tipo = 'extraordinario'
					)`
				)
			)
			.groupBy(giseSeccionais.gise_id, giseSeccionais.seccional_id)
			.having(sql`count(*) = count(${gisePresencas.saida_timestamp})`)
			.all(),
		// Seccionais que já finalizaram o envio de sua escala (status != 'pendente')
		db
			.select({ gise_id: giseSeccionais.gise_id, count: sql<number>`count(*)` })
			.from(giseSeccionais)
			.where(and(inArray(giseSeccionais.gise_id, escalaIds), ne(giseSeccionais.status, 'pendente')))
			.groupBy(giseSeccionais.gise_id)
			.all()
	]);

	const [
		saidasRows,
		secCountRows,
		assExtraRows,
		supUid,
		membroSecRows,
		seccionalIdsRows,
		equipeTypesRows,
		extrasPendIdsRows,
		seccionaisEnviadasRows
	] = parallelResults as [
		Array<{ gise_id: number }>,
		Array<{ gise_id: number; count: number }>,
		Array<{ gise_id: number; seccional_id: number }>,
		number | null,
		Array<{ gise_id: number; seccional_id: number }>,
		Array<{ gise_id: number; seccional_id: number; nome: string }>,
		Array<{ gise_id: number; seccional_id: number; tipo: string }>,
		Array<{ gise_id: number; seccional_id: number }>,
		Array<{ gise_id: number; count: number }>
	];

	// Coleta presenças da supervisão para todas as escalas
	const todosSupIds = new Set<number>();
	for (const e of escalas) {
		if (e.supervisor_id) todosSupIds.add(e.supervisor_id);
		if (e.assessor_id) todosSupIds.add(e.assessor_id);
		if (e.seint1_id) todosSupIds.add(e.seint1_id);
		if (e.seint2_id) todosSupIds.add(e.seint2_id);
	}
	const supPresRows =
		todosSupIds.size > 0
			? await db
					.select()
					.from(gisePresencas)
					.where(
						and(
							inArray(gisePresencas.gise_id, escalaIds),
							inArray(gisePresencas.policial_id, [...todosSupIds])
						)
					)
					.all()
			: [];
	const supPresMap = new Map<string, { entrada: string | null; saida: string | null }>();
	for (const p of supPresRows) {
		supPresMap.set(`${p.gise_id}_${p.policial_id}`, {
			entrada: p.entrada_timestamp,
			saida: p.saida_timestamp
		});
	}

	// Build lookup maps for O(1) access
	const saidasSet = new Set((saidasRows as Array<{ gise_id: number }>).map((r) => r.gise_id));
	const secCountMap = new Map(
		(secCountRows as Array<{ gise_id: number; count: number }>).map((r) => [r.gise_id, r.count])
	);
	const assExtraMap = new Map<number, Set<number>>();
	for (const r of assExtraRows as Array<{ gise_id: number; seccional_id: number }>) {
		if (!assExtraMap.has(r.gise_id)) assExtraMap.set(r.gise_id, new Set());
		assExtraMap.get(r.gise_id)!.add(r.seccional_id);
	}
	const membroSecMap = new Map(
		(membroSecRows as Array<{ gise_id: number; seccional_id: number }>).map((r) => [
			r.gise_id,
			r.seccional_id
		])
	);
	const extrasPendIdsMap = new Map<number, number[]>();
	for (const r of extrasPendIdsRows) {
		if (!extrasPendIdsMap.has(r.gise_id)) extrasPendIdsMap.set(r.gise_id, []);
		extrasPendIdsMap.get(r.gise_id)!.push(r.seccional_id);
	}
	const secEnvMap = new Map(
		(seccionaisEnviadasRows as Array<{ gise_id: number; count: number }>).map((r) => [
			r.gise_id,
			r.count
		])
	);
	const equipeTypesMap = new Map<string, Set<string>>();
	for (const row of equipeTypesRows as Array<{
		gise_id: number;
		seccional_id: number;
		tipo: string;
	}>) {
		const key = `${row.gise_id}_${row.seccional_id}`;
		if (!equipeTypesMap.has(key)) equipeTypesMap.set(key, new Set());
		equipeTypesMap.get(key)!.add(row.tipo);
	}

	const seccionaisMap = new Map<number, { id: number; nome: string; tipos: string[] }[]>();
	for (const row of seccionalIdsRows as Array<{
		gise_id: number;
		seccional_id: number;
		nome: string;
	}>) {
		if (!seccionaisMap.has(row.gise_id)) seccionaisMap.set(row.gise_id, []);
		const tipos = [
			...(equipeTypesMap.get(`${row.gise_id}_${row.seccional_id}`) ?? new Set(['operacional']))
		];
		seccionaisMap.get(row.gise_id)!.push({ id: row.seccional_id, nome: row.nome, tipos });
	}

	return escalas.map((e) => {
		const signedSecs = assExtraMap.get(e.id) ?? new Set<number>();
		const pendentes = extrasPendIdsMap.get(e.id) ?? [];

		// Se tem quadro de supervisão e todos os definidos saíram, e ainda não assinou o relatório extra da supervisão, inclui como pendente
		if (supUid != null) {
			const supIds = [
				...new Set(
					[e.supervisor_id, e.assessor_id, e.seint1_id, e.seint2_id].filter(
						(id): id is number => id != null
					)
				)
			];
			if (supIds.length > 0) {
				const todosSairam = supIds.every((id) => {
					const p = supPresMap.get(`${e.id}_${id}`);
					return p?.entrada && p?.saida;
				});
				if (todosSairam && !signedSecs.has(supUid)) {
					pendentes.push(supUid);
				}
			}
		}

		return {
			...e,
			temSaidaConfirmada: saidasSet.has(e.id),
			totalSeccionais: secCountMap.get(e.id) ?? 0,
			assinaturasRelatorioExtra: signedSecs.size,
			assinaturasRelatorioExtraIds: Array.from(signedSecs),
			policialSeccionalId: membroSecMap.get(e.id) ?? null,
			seccionais: seccionaisMap.get(e.id) ?? [],
			extrasPendentesIds: pendentes,
			extrasPendentes: pendentes.length,
			seccionaisEnviadas: secEnvMap.get(e.id) ?? 0
		};
	});
}

/**
 * Carrega uma GISE completa com todas as suas seccionais, equipes, membros e presenças.
 * Usa batch loading para evitar N+1 queries.
 */
export async function buscarGiseDetalhado(db: Database, id: number): Promise<GiseDetalhado | null> {
	const gise = await db.select().from(giseEscalas).where(eq(giseEscalas.id, id)).get();
	if (!gise) return null;

	// Carrega dados em paralelo para minimizar round-trips ao banco
	const parallelResults = await Promise.all([
		gise.supervisor_id
			? db
					.select({
						nome: policiais.nome,
						matricula: policiais.matricula,
						telefone: policiais.telefone
					})
					.from(policiais)
					.where(eq(policiais.id, gise.supervisor_id))
					.get()
			: Promise.resolve(null),
		gise.assessor_id
			? db
					.select({
						nome: policiais.nome,
						matricula: policiais.matricula,
						telefone: policiais.telefone
					})
					.from(policiais)
					.where(eq(policiais.id, gise.assessor_id))
					.get()
			: Promise.resolve(null),
		gise.seint1_id
			? db
					.select({
						nome: policiais.nome,
						matricula: policiais.matricula,
						telefone: policiais.telefone
					})
					.from(policiais)
					.where(eq(policiais.id, gise.seint1_id))
					.get()
			: Promise.resolve(null),
		gise.seint2_id
			? db
					.select({
						nome: policiais.nome,
						matricula: policiais.matricula,
						telefone: policiais.telefone
					})
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

	const [
		supervisorRow,
		assessorRow,
		seint1Row,
		seint2Row,
		documento,
		secsRows,
		todasEquipes,
		todosMembros,
		todasPresencas,
		todasRespostas,
		assExtraRow
	] = parallelResults;

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
