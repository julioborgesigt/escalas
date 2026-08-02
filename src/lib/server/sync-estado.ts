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
	giseEscalas,
	gisePresencas,
	giseAssinaturasRelatorios,
	giseSeccionais,
	giseEquipes,
	giseMembros,
	giseDocumentos
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

export async function carimboGise(db: Database, giseId: number): Promise<string | null> {
	const [gise] = await db
		.select({ status: giseEscalas.status })
		.from(giseEscalas)
		.where(eq(giseEscalas.id, giseId))
		.limit(1);
	if (!gise) return null;

	const [[pres], [rels], [secs], [membros], [docs]] = await Promise.all([
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
				statuses: sql<string>`coalesce(group_concat(${giseSeccionais.status}), '')`
			})
			.from(giseSeccionais)
			.where(eq(giseSeccionais.gise_id, giseId)),
		db
			.select({ n: sql<number>`count(*)` })
			.from(giseMembros)
			.innerJoin(giseEquipes, eq(giseMembros.equipe_id, giseEquipes.id))
			.innerJoin(giseSeccionais, eq(giseEquipes.gise_seccional_id, giseSeccionais.id))
			.where(eq(giseSeccionais.gise_id, giseId)),
		db
			.select({ n: sql<number>`count(*)` })
			.from(giseDocumentos)
			.where(eq(giseDocumentos.gise_id, giseId))
	]);

	return [
		gise.status,
		Number(pres?.n ?? 0),
		pres?.maxUp ?? '',
		Number(rels?.n ?? 0),
		Number(secs?.n ?? 0),
		secs?.statuses ?? '',
		Number(membros?.n ?? 0),
		Number(docs?.n ?? 0)
	].join('|');
}

/** Mudanças em escalas (criar/assinar/excluir) — suficiente para invalidar o compliance. */
export async function carimboPainel(db: Database): Promise<string> {
	const [[esc], [docs]] = await Promise.all([
		db
			.select({
				n: sql<number>`count(*)`,
				maxId: sql<number>`coalesce(max(${escalas.id}), 0)`
			})
			.from(escalas),
		db.select({ n: sql<number>`count(*)` }).from(escalaDocumentos)
	]);
	return `${Number(esc?.n ?? 0)}:${Number(esc?.maxId ?? 0)}:${Number(docs?.n ?? 0)}`;
}
