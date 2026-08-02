/**
 * Carimbos leves para o poll de revalidação (`GET /api/sync/estado`).
 * Cada stamp muda quando o conjunto de dados da tela correspondente muda,
 * sem montar o payload completo do `load`.
 */
import { and, eq, inArray, or, sql, type SQL } from 'drizzle-orm';
import type { Database } from '$lib/db';
import {
	escalas,
	escalaDocumentos,
	escalaSolicitacoesAssinatura,
	escalaPoliciais,
	giseEscalas,
	gisePresencas,
	giseAssinaturasRelatorios,
	giseSeccionais,
	giseEquipes,
	giseMembros,
	giseDocumentos,
	giseSeccionalUnidades,
	giseRespostasFormulario,
	giseModeloFormulario
} from '$lib/server/schema';

export async function resumoRecebidosAdmin(db: Database): Promise<{
	naoVistos: number;
	stamp: string;
}> {
	const [row] = await db
		.select({
			naoVistos: sql<number>`coalesce(sum(case when ${escalas.visto_por_admin} = 0 then 1 else 0 end), 0)`,
			total: sql<number>`count(*)`,
			maxId: sql<number>`coalesce(max(${escalas.id}), 0)`
		})
		.from(escalas)
		.innerJoin(escalaDocumentos, eq(escalaDocumentos.escala_id, escalas.id));

	const naoVistos = Number(row?.naoVistos ?? 0);
	const total = Number(row?.total ?? 0);
	const maxId = Number(row?.maxId ?? 0);
	return { naoVistos, stamp: `${naoVistos}:${total}:${maxId}` };
}

/** Contagem + stamp das solicitações de assinatura visíveis ao DPC admin. */
export async function resumoEscalasPendentes(
	db: Database,
	usuario: {
		id: number;
		papel?: string | null;
		lotacao?: string | null;
	},
	lotacoesPermitidas?: string[]
): Promise<{ pendentes: number; stamp: string }> {
	const baseWhere = sql`${escalaDocumentos.escala_id} IS NULL`;

	let scopeCondition: SQL | undefined;
	if (usuario.papel === 'admin_unidade') {
		scopeCondition = and(
			eq(escalaSolicitacoesAssinatura.tipo, 'unidade'),
			eq(escalas.lotacao, usuario.lotacao ?? '')
		);
	} else if (usuario.papel === 'admin_seccional' && lotacoesPermitidas?.length) {
		scopeCondition = or(
			and(
				eq(escalaSolicitacoesAssinatura.tipo, 'unidade'),
				inArray(escalas.lotacao, lotacoesPermitidas)
			),
			and(
				eq(escalaSolicitacoesAssinatura.tipo, 'respondencia'),
				eq(escalaSolicitacoesAssinatura.destinatario_id, usuario.id)
			)
		);
	} else {
		return { pendentes: 0, stamp: '0:0' };
	}

	const [row] = await db
		.select({
			pendentes: sql<number>`count(*)`,
			maxId: sql<number>`coalesce(max(${escalas.id}), 0)`
		})
		.from(escalas)
		.innerJoin(escalaSolicitacoesAssinatura, eq(escalaSolicitacoesAssinatura.escala_id, escalas.id))
		.leftJoin(escalaDocumentos, eq(escalaDocumentos.escala_id, escalas.id))
		.where(and(baseWhere, scopeCondition));

	const pendentes = Number(row?.pendentes ?? 0);
	const maxId = Number(row?.maxId ?? 0);
	return { pendentes, stamp: `${pendentes}:${maxId}` };
}

/**
 * Carimbo da tela GISE detalhe. Inclui quadro de supervisão, horários, breve
 * relatório (tamanho), slots e unidades — não só contagens grossas.
 */
export async function carimboGise(db: Database, giseId: number): Promise<string | null> {
	const [gise] = await db
		.select({
			status: giseEscalas.status,
			data_inicio: giseEscalas.data_inicio,
			hora_entrada: giseEscalas.hora_entrada,
			hora_saida: giseEscalas.hora_saida,
			supervisor_id: giseEscalas.supervisor_id,
			assessor_id: giseEscalas.assessor_id,
			seint1_id: giseEscalas.seint1_id,
			seint2_id: giseEscalas.seint2_id,
			brTitulo: sql<number>`length(coalesce(${giseEscalas.breve_relatorio_titulo}, ''))`,
			brSec: sql<number>`length(coalesce(${giseEscalas.breve_relatorio_texto_seccional}, ''))`,
			brSup: sql<number>`length(coalesce(${giseEscalas.breve_relatorio_texto_supervisao}, ''))`
		})
		.from(giseEscalas)
		.where(eq(giseEscalas.id, giseId))
		.limit(1);
	if (!gise) return null;

	const [[pres], [rels], [secs], [equipes], [membros], [unidadesSlot], [docs], [resps]] =
		await Promise.all([
			db
				.select({
					n: sql<number>`count(*)`,
					maxUp: sql<string>`coalesce(max(${gisePresencas.updated_at}), '')`
				})
				.from(gisePresencas)
				.where(eq(gisePresencas.gise_id, giseId)),
			db
				.select({ n: sql<number>`count(*)` })
				.from(giseAssinaturasRelatorios)
				.where(eq(giseAssinaturasRelatorios.gise_id, giseId)),
			db
				.select({
					n: sql<number>`count(*)`,
					finger: sql<string>`coalesce(group_concat(${giseSeccionais.status} || ':' || coalesce(${giseSeccionais.hora_entrada}, '') || '-' || coalesce(${giseSeccionais.hora_saida}, '')), '')`
				})
				.from(giseSeccionais)
				.where(eq(giseSeccionais.gise_id, giseId)),
			db
				.select({
					n: sql<number>`count(*)`,
					slots: sql<number>`coalesce(sum(${giseEquipes.slots_dpc} + ${giseEquipes.slots_oip}), 0)`,
					finger: sql<string>`coalesce(group_concat(coalesce(${giseEquipes.hora_entrada}, '') || '-' || coalesce(${giseEquipes.hora_saida}, '') || ':' || coalesce(${giseEquipes.gise_unidade_id}, 0)), '')`
				})
				.from(giseEquipes)
				.innerJoin(giseSeccionais, eq(giseEquipes.gise_seccional_id, giseSeccionais.id))
				.where(eq(giseSeccionais.gise_id, giseId)),
			db
				.select({ n: sql<number>`count(*)` })
				.from(giseMembros)
				.innerJoin(giseEquipes, eq(giseMembros.equipe_id, giseEquipes.id))
				.innerJoin(giseSeccionais, eq(giseEquipes.gise_seccional_id, giseSeccionais.id))
				.where(eq(giseSeccionais.gise_id, giseId)),
			db
				.select({ n: sql<number>`count(*)` })
				.from(giseSeccionalUnidades)
				.innerJoin(giseSeccionais, eq(giseSeccionalUnidades.gise_seccional_id, giseSeccionais.id))
				.where(eq(giseSeccionais.gise_id, giseId)),
			db
				.select({ n: sql<number>`count(*)` })
				.from(giseDocumentos)
				.where(eq(giseDocumentos.gise_id, giseId)),
			db
				.select({
					n: sql<number>`count(*)`,
					maxUp: sql<string>`coalesce(max(${giseRespostasFormulario.updated_at}), '')`
				})
				.from(giseRespostasFormulario)
				.where(eq(giseRespostasFormulario.gise_id, giseId))
		]);

	return [
		gise.status,
		gise.data_inicio,
		gise.hora_entrada,
		gise.hora_saida,
		gise.supervisor_id ?? 0,
		gise.assessor_id ?? 0,
		gise.seint1_id ?? 0,
		gise.seint2_id ?? 0,
		Number(gise.brTitulo ?? 0),
		Number(gise.brSec ?? 0),
		Number(gise.brSup ?? 0),
		Number(pres?.n ?? 0),
		pres?.maxUp ?? '',
		Number(rels?.n ?? 0),
		Number(secs?.n ?? 0),
		secs?.finger ?? '',
		Number(equipes?.n ?? 0),
		Number(equipes?.slots ?? 0),
		equipes?.finger ?? '',
		Number(membros?.n ?? 0),
		Number(unidadesSlot?.n ?? 0),
		Number(docs?.n ?? 0),
		Number(resps?.n ?? 0),
		resps?.maxUp ?? ''
	].join('|');
}

/** Mudanças em escalas (criar/assinar/excluir/ver) — suficiente para o compliance. */
export async function carimboPainel(db: Database): Promise<string> {
	const [[esc], [docs]] = await Promise.all([
		db
			.select({
				n: sql<number>`count(*)`,
				maxId: sql<number>`coalesce(max(${escalas.id}), 0)`,
				maxCreated: sql<string>`coalesce(max(${escalas.created_at}), '')`,
				vistos: sql<number>`coalesce(sum(${escalas.visto_por_admin}), 0)`,
				finalizadas: sql<number>`coalesce(sum(case when ${escalas.finalizada_em} is not null then 1 else 0 end), 0)`
			})
			.from(escalas),
		db.select({ n: sql<number>`count(*)` }).from(escalaDocumentos)
	]);
	return [
		Number(esc?.n ?? 0),
		Number(esc?.maxId ?? 0),
		esc?.maxCreated ?? '',
		Number(esc?.vistos ?? 0),
		Number(esc?.finalizadas ?? 0),
		Number(docs?.n ?? 0)
	].join(':');
}

/**
 * Carimbo de `/res-gise`: presença/relatório do policial, ou modelo (admin).
 */
export async function carimboResGise(db: Database, policialId: number | null): Promise<string> {
	if (policialId == null) {
		const [row] = await db
			.select({
				n: sql<number>`count(*)`,
				maxUp: sql<string>`coalesce(max(${giseModeloFormulario.updated_at}), '')`
			})
			.from(giseModeloFormulario);
		return `admin:${Number(row?.n ?? 0)}:${row?.maxUp ?? ''}`;
	}

	const [[pres], [resp], [membro], [sup]] = await Promise.all([
		db
			.select({
				n: sql<number>`count(*)`,
				maxUp: sql<string>`coalesce(max(${gisePresencas.updated_at}), '')`
			})
			.from(gisePresencas)
			.where(eq(gisePresencas.policial_id, policialId)),
		db
			.select({
				n: sql<number>`count(*)`,
				maxUp: sql<string>`coalesce(max(${giseRespostasFormulario.updated_at}), '')`
			})
			.from(giseRespostasFormulario)
			.where(eq(giseRespostasFormulario.policial_id, policialId)),
		db
			.select({
				n: sql<number>`count(*)`,
				statuses: sql<string>`coalesce(group_concat(${giseEscalas.status}), '')`,
				maxId: sql<number>`coalesce(max(${giseEscalas.id}), 0)`
			})
			.from(giseMembros)
			.innerJoin(giseEquipes, eq(giseMembros.equipe_id, giseEquipes.id))
			.innerJoin(giseSeccionais, eq(giseEquipes.gise_seccional_id, giseSeccionais.id))
			.innerJoin(giseEscalas, eq(giseSeccionais.gise_id, giseEscalas.id))
			.where(eq(giseMembros.policial_id, policialId)),
		db
			.select({
				n: sql<number>`count(*)`,
				statuses: sql<string>`coalesce(group_concat(${giseEscalas.status}), '')`,
				maxId: sql<number>`coalesce(max(${giseEscalas.id}), 0)`
			})
			.from(giseEscalas)
			.where(
				or(
					eq(giseEscalas.supervisor_id, policialId),
					eq(giseEscalas.assessor_id, policialId),
					eq(giseEscalas.seint1_id, policialId),
					eq(giseEscalas.seint2_id, policialId)
				)
			)
	]);

	return [
		Number(pres?.n ?? 0),
		pres?.maxUp ?? '',
		Number(resp?.n ?? 0),
		resp?.maxUp ?? '',
		Number(membro?.n ?? 0),
		membro?.statuses ?? '',
		Number(membro?.maxId ?? 0),
		Number(sup?.n ?? 0),
		sup?.statuses ?? '',
		Number(sup?.maxId ?? 0)
	].join('|');
}

/** Lista `/gise` — ativas + histórico resumido. */
export async function carimboGiseList(db: Database): Promise<string> {
	const [[tot], [ativas]] = await Promise.all([
		db
			.select({
				n: sql<number>`count(*)`,
				maxId: sql<number>`coalesce(max(${giseEscalas.id}), 0)`
			})
			.from(giseEscalas),
		db
			.select({
				n: sql<number>`count(*)`,
				finger: sql<string>`coalesce(group_concat(${giseEscalas.id} || ':' || ${giseEscalas.status}), '')`
			})
			.from(giseEscalas)
			.where(sql`${giseEscalas.status} != 'finalizada'`)
	]);
	return `${Number(tot?.n ?? 0)}:${Number(tot?.maxId ?? 0)}:${Number(ativas?.n ?? 0)}:${ativas?.finger ?? ''}`;
}

/** Detalhe `/escalas/[id]` — servidores, documento e solicitação. */
export async function carimboEscala(db: Database, escalaId: number): Promise<string | null> {
	const [esc] = await db
		.select({
			id: escalas.id,
			finalizada_em: escalas.finalizada_em,
			visto: escalas.visto_por_admin,
			data_inicio: escalas.data_inicio,
			data_fim: escalas.data_fim
		})
		.from(escalas)
		.where(eq(escalas.id, escalaId))
		.limit(1);
	if (!esc) return null;

	const [[pols], [doc], [sol]] = await Promise.all([
		db
			.select({
				n: sql<number>`count(*)`,
				finger: sql<string>`coalesce(group_concat(${escalaPoliciais.policial_id} || ':' || ${escalaPoliciais.data_plantao} || ':' || ${escalaPoliciais.hora_entrada} || '-' || ${escalaPoliciais.hora_saida}), '')`
			})
			.from(escalaPoliciais)
			.where(eq(escalaPoliciais.escala_id, escalaId)),
		db
			.select({ n: sql<number>`count(*)` })
			.from(escalaDocumentos)
			.where(eq(escalaDocumentos.escala_id, escalaId)),
		db
			.select({
				n: sql<number>`count(*)`,
				tipos: sql<string>`coalesce(group_concat(${escalaSolicitacoesAssinatura.tipo}), '')`
			})
			.from(escalaSolicitacoesAssinatura)
			.where(eq(escalaSolicitacoesAssinatura.escala_id, escalaId))
	]);

	return [
		esc.finalizada_em ?? '',
		esc.visto,
		esc.data_inicio,
		esc.data_fim,
		Number(pols?.n ?? 0),
		pols?.finger ?? '',
		Number(doc?.n ?? 0),
		Number(sol?.n ?? 0),
		sol?.tipos ?? ''
	].join('|');
}
