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
import type { GiseDetalhado, GiseUnidadeSlot } from './types';
import { buscarUnidadeIdSupervisaoExtra } from '../../server/gise/supervisao-extra';

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
		// TODOS os membros confirmaram a saída e o extra ainda não foi
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
 *
 * ## Duas idas ao banco, e por que não uma nem treze
 *
 * Antes eram TREZE: a escala, depois um `Promise.all` de onze, depois os slots
 * de unidade em série. `Promise.all` dispara as onze ao mesmo tempo, mas cada
 * uma continua sendo uma ida à rede — no D1 o que custa é o número de idas, e
 * paralelizar não reduz esse número. `db.batch()` resolve N statements em UMA.
 *
 * O que sobra são duas idas porque uma delas DEPENDE da outra: o quadro de
 * supervisão (supervisor, assessor, SEINT 1 e 2) é buscado por ids que só
 * existem depois de ler a linha da escala. As quatro consultas viraram uma só,
 * por `inArray` — e o mapa por id resolve de graça o caso de a mesma pessoa
 * acumular dois papéis, que quatro consultas separadas tratavam por acidente.
 *
 * O primeiro lote roda inteiro mesmo quando o id não existe (devolve tudo
 * vazio, e a função devolve `null` logo abaixo). É deliberado: separar a
 * checagem custaria de volta a ida que este lote economiza, e GISE inexistente
 * é o caminho raro.
 *
 * Efeito colateral bem-vindo: o `batch` do D1 roda em TRANSAÇÃO, então as nove
 * leituras do primeiro lote enxergam o mesmo instante do banco. Onze consultas
 * concorrentes podiam pegar a escala antes e os membros depois de uma escrita.
 *
 * ## A armadilha do batch com join: NOMES DE COLUNA repetidos no SQL
 *
 * Dentro de `db.batch()`, nenhuma consulta pode produzir duas colunas com o
 * MESMO NOME. Não é preferência de estilo — é corretude, e o modo de falhar é
 * silencioso.
 *
 * Repare no que conta: o nome da COLUNA no SQL, não a chave do objeto em
 * TypeScript. `select({ sec_id: giseSeccionais.id })` NÃO resolve nada — o
 * drizzle não emite `AS` para seleção simples de coluna, então o SQL continua
 * com `"gise_seccionais"."id"` e continua colidindo com `"gise_equipes"."id"`.
 * A saída aqui foi não selecionar a coluna duplicada: a seccional entra só no
 * `innerJoin`, e quem precisa do id dela usa a FK `gise_seccional_id` da
 * própria equipe.
 *
 * Fora do batch, o driver do D1 pede as linhas com `stmt.raw()` e recebe arrays
 * POSICIONAIS. Dentro do batch não existe `.raw()`: o D1 devolve cada linha como
 * OBJETO chaveado por nome de coluna, e o drizzle reconstrói o array com
 * `Object.keys(row).map(...)` (`d1ToRawMapping`, em `drizzle-orm/d1/session.js`).
 * Se duas tabelas do join têm colunas de mesmo nome, o objeto guarda UMA chave
 * só: o array sai mais curto que o `SELECT`, e todo campo depois da colisão é
 * lido da posição errada.
 *
 * Foi o que aconteceu aqui em set/2026, em duas rodadas. `select().from(
 * giseEquipes).innerJoin(giseSeccionais, …)` repete `id`, `status`,
 * `hora_entrada` e `hora_saida`: a equipe com horário próprio (07:00-13:00)
 * passou a exibir o da seccional (NULL). Trocar para lista explícita mantendo
 * `giseSeccionais.id` moveu a colisão em vez de removê-la — as horas voltaram
 * (estão antes dela na ordem) e o `id` da equipe passou a ser o da seccional,
 * o que desmontou o agrupamento de membros e o card da seccional. Sem erro,
 * sem log, nas duas vezes.
 *
 * **O vitest não pega isto**, e é o ponto mais importante deste aviso: o harness
 * (`sqlite-proxy`) devolve arrays nos DOIS caminhos, então ele é mais tolerante
 * que a produção. Quem pegou foi o E2E `gise-abas-unidade.spec.ts`, com browser
 * de verdade contra o D1 local.
 */
export async function buscarGiseDetalhado(db: Database, id: number): Promise<GiseDetalhado | null> {
	return (await buscarGiseDetalhadoEmLote(db, [id])).get(id) ?? null;
}

/**
 * A versão em LOTE: as mesmas duas idas ao banco para N escalas.
 *
 * Existe porque o export do histórico chamava `buscarGiseDetalhado` num laço —
 * 13 consultas por escala, em série. Quarenta escalas eram 520 idas ao D1, e o
 * comentário que defendia o laço dizia que paralelizar "aumentaria a chance de
 * estourar o limite de subrequests". Paralelizar não muda a QUANTIDADE de
 * subrequests, só a concorrência: o que muda a quantidade é buscar em lote.
 *
 * O agrupamento em memória custa quase nada além do que já se fazia porque as
 * chaves envolvidas — id de slot, de seccional e de equipe — são PKs, únicas
 * ENTRE escalas. Duas exceções, e são as que exigem cuidado:
 *
 *  - **presença** é `(gise_id, policial_id)`: o mesmo policial tem uma linha por
 *    escala, então a chave do mapa precisa das duas partes. Chavear só por
 *    policial faria a presença de uma escala vazar para outra;
 *  - **assinaturas de relatório extra** viram `count(*)` com `GROUP BY gise_id`,
 *    em vez de um count por escala.
 *
 * Devolve um `Map` por id. Escala inexistente simplesmente não aparece — quem
 * quiser `null` usa `buscarGiseDetalhado`.
 */
export async function buscarGiseDetalhadoEmLote(
	db: Database,
	ids: readonly number[]
): Promise<Map<number, GiseDetalhado>> {
	const alvo = [...new Set(ids)];
	if (alvo.length === 0) return new Map();

	const [
		giseRows,
		documentoRows,
		secsRows,
		todasEquipes,
		todosMembros,
		todasPresencas,
		todasRespostas,
		assExtraRows,
		todosSlotsUnidade
	] = await db.batch([
		db.select().from(giseEscalas).where(inArray(giseEscalas.id, alvo)),
		db.select().from(giseDocumentos).where(inArray(giseDocumentos.gise_id, alvo)),
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
			.where(inArray(giseSeccionais.gise_id, alvo))
			.orderBy(asc(unidades.nome)),
		// Colunas de UMA tabela só, e isto não é estilo — é o que torna a consulta
		// segura dentro de `db.batch()`. Ver "A armadilha do batch com join" no
		// cabeçalho: o que colide são os NOMES DE COLUNA no SQL, e o join traz
		// `id`, `status`, `hora_entrada` e `hora_saida` nas duas tabelas.
		//
		// A seccional entra só no `innerJoin`, para o `WHERE` alcançar `gise_id`;
		// nada dela é selecionado. Quem precisa do id da seccional usa
		// `gise_seccional_id`, que é a FK da própria equipe para aquela linha —
		// mesmo valor, sem duplicar nome de coluna.
		db
			.select({
				id: giseEquipes.id,
				gise_seccional_id: giseEquipes.gise_seccional_id,
				gise_unidade_id: giseEquipes.gise_unidade_id,
				tipo: giseEquipes.tipo,
				slots_dpc: giseEquipes.slots_dpc,
				slots_oip: giseEquipes.slots_oip,
				hora_entrada: giseEquipes.hora_entrada,
				hora_saida: giseEquipes.hora_saida
			})
			.from(giseEquipes)
			.innerJoin(giseSeccionais, eq(giseEquipes.gise_seccional_id, giseSeccionais.id))
			.where(inArray(giseSeccionais.gise_id, alvo)),
		db
			.select({
				id: giseMembros.id,
				equipe_id: giseMembros.equipe_id,
				policial_id: giseMembros.policial_id,
				gise_id: giseMembros.gise_id,
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
			.where(inArray(giseSeccionais.gise_id, alvo)),
		db.select().from(gisePresencas).where(inArray(gisePresencas.gise_id, alvo)),
		db
			.select({
				gise_id: giseRespostasFormulario.gise_id,
				equipe_seccional_id: giseEquipes.gise_seccional_id
			})
			.from(giseRespostasFormulario)
			.innerJoin(giseMembros, eq(giseRespostasFormulario.policial_id, giseMembros.policial_id))
			.innerJoin(giseEquipes, eq(giseMembros.equipe_id, giseEquipes.id))
			.where(inArray(giseRespostasFormulario.gise_id, alvo)),
		db
			.select({
				gise_id: giseAssinaturasRelatorios.gise_id,
				count: sql<number>`count(*)`
			})
			.from(giseAssinaturasRelatorios)
			.where(
				and(
					inArray(giseAssinaturasRelatorios.gise_id, alvo),
					eq(giseAssinaturasRelatorios.tipo, 'extraordinario')
				)
			)
			.groupBy(giseAssinaturasRelatorios.gise_id),
		// Slots de unidade por seccional (LEFT JOIN: `unidade_id` pode ser null).
		db
			.select({
				id: giseSeccionalUnidades.id,
				gise_seccional_id: giseSeccionalUnidades.gise_seccional_id,
				unidade_id: giseSeccionalUnidades.unidade_id,
				nome: unidades.nome
			})
			.from(giseSeccionalUnidades)
			.leftJoin(unidades, eq(giseSeccionalUnidades.unidade_id, unidades.id))
			.innerJoin(giseSeccionais, eq(giseSeccionalUnidades.gise_seccional_id, giseSeccionais.id))
			.where(inArray(giseSeccionais.gise_id, alvo))
			.orderBy(asc(giseSeccionalUnidades.id))
	]);

	if (giseRows.length === 0) return new Map();

	// Segunda ida: o quadro de supervisão de TODAS as escalas, por ids que só
	// existem depois de lê-las. Uma consulta para os quatro papéis de todas — o
	// mapa por id também cobre a mesma pessoa acumulando dois deles.
	const idsQuadro = [
		...new Set(
			giseRows
				.flatMap((g) => [g.supervisor_id, g.assessor_id, g.seint1_id, g.seint2_id])
				.filter((v): v is number => v != null)
		)
	];
	const quadro = new Map<number, { nome: string; matricula: string; telefone: string | null }>();
	if (idsQuadro.length > 0) {
		const linhas = await db
			.select({
				id: policiais.id,
				nome: policiais.nome,
				matricula: policiais.matricula,
				telefone: policiais.telefone
			})
			.from(policiais)
			.where(inArray(policiais.id, idsQuadro));
		for (const p of linhas) quadro.set(p.id, p);
	}
	const doQuadro = (pid: number | null) => (pid == null ? undefined : quadro.get(pid));

	// Índices em memória para lookups O(1). Slot, seccional e equipe são PKs —
	// únicos entre escalas —, então um mapa só serve o lote inteiro. Presença
	// NÃO é: a chave carrega o gise, senão a presença de uma escala apareceria
	// na outra para o mesmo policial.
	const chavePresenca = (giseId: number, policialId: number) => `${giseId}:${policialId}`;
	const presencaMap = new Map(
		todasPresencas.map((p) => [chavePresenca(p.gise_id, p.policial_id), p])
	);
	const seccionalComRespostas = new Set(todasRespostas.map((r) => r.equipe_seccional_id));
	const documentoPorGise = new Map(documentoRows.map((d) => [d.gise_id, d]));
	const assExtraPorGise = new Map(assExtraRows.map((a) => [a.gise_id, Number(a.count ?? 0)]));

	const saidaConfirmadaPorGise = new Set(
		todasPresencas.filter((p) => p.saida_timestamp !== null).map((p) => p.gise_id)
	);

	const secsPorGise = new Map<number, typeof secsRows>();
	for (const sec of secsRows) {
		if (!secsPorGise.has(sec.gise_id)) secsPorGise.set(sec.gise_id, []);
		secsPorGise.get(sec.gise_id)!.push(sec);
	}

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
		const unidadeId = row.gise_unidade_id;
		if (unidadeId !== null && unidadeId !== undefined) {
			if (!equipesPorUnidade.has(unidadeId)) equipesPorUnidade.set(unidadeId, []);
			equipesPorUnidade.get(unidadeId)!.push(row);
		} else {
			const secId = row.gise_seccional_id;
			if (!equipesSemUnidadePorSeccional.has(secId)) equipesSemUnidadePorSeccional.set(secId, []);
			equipesSemUnidadePorSeccional.get(secId)!.push(row);
		}
	}

	const membrosPorEquipe = new Map<number, typeof todosMembros>();
	for (const m of todosMembros) {
		if (!membrosPorEquipe.has(m.equipe_id)) membrosPorEquipe.set(m.equipe_id, []);
		membrosPorEquipe.get(m.equipe_id)!.push(m);
	}

	/** `giseId` entra porque a presença é por (escala, policial), não por policial. */
	function buildEquipes(rows: typeof todasEquipes, giseId: number) {
		return rows.map((equipe) => {
			const membrosRaw = membrosPorEquipe.get(equipe.id) ?? [];
			const membros = membrosRaw.map((m) => ({
				...m,
				presenca: presencaMap.get(chavePresenca(giseId, m.policial_id)) ?? null
			}));
			return { ...equipe, membros };
		});
	}

	const saida = new Map<number, GiseDetalhado>();
	for (const gise of giseRows) {
		const seccionais = (secsPorGise.get(gise.id) ?? []).map((sec) => {
			const slots = slotsPorSeccional.get(sec.id) ?? [];

			let unidades: GiseUnidadeSlot[] = [];
			if (slots.length > 0) {
				unidades = slots.map((slot) => ({
					id: slot.id,
					unidade_id: slot.unidade_id,
					nome: slot.nome,
					equipes: buildEquipes(equipesPorUnidade.get(slot.id) ?? [], gise.id)
				}));
			}
			// Equipes sem unidade (legado ou mal formadas) aparecem em um slot avulso com ID 0
			const equipesLegado = buildEquipes(equipesSemUnidadePorSeccional.get(sec.id) ?? [], gise.id);
			if (equipesLegado.length > 0) {
				unidades.unshift({ id: 0, unidade_id: null, nome: null, equipes: equipesLegado });
			}

			return {
				...sec,
				unidades,
				temRespostas: seccionalComRespostas.has(sec.id)
			};
		});

		const supervisorRow = doQuadro(gise.supervisor_id);
		const assessorRow = doQuadro(gise.assessor_id);
		const seint1Row = doQuadro(gise.seint1_id);
		const seint2Row = doQuadro(gise.seint2_id);

		saida.set(gise.id, {
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
			documento: documentoPorGise.get(gise.id) ?? null,
			totalSeccionais: seccionais.length,
			assinaturasRelatorioExtra: assExtraPorGise.get(gise.id) ?? 0,
			temSaidaConfirmada: saidaConfirmadaPorGise.has(gise.id)
		});
	}

	return saida;
}
