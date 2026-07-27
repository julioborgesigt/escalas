/**
 * Predicados de "este policial tem papel em GISE ATIVA?" — usados para liberar
 * menus e rotas da GISE a quem não é admin.
 *
 * O papel aqui é TEMPORÁRIO por natureza: vale enquanto a GISE não é finalizada,
 * e é isso que `ne(status, 'finalizada')` implementa em todos eles. Terminado o
 * plantão, o acesso se fecha sozinho — não há revogação a fazer, e é por isso que
 * essas permissões não moram em `policiais.papel`.
 */
import { eq, and, ne, or } from 'drizzle-orm';
import { giseEscalas, giseSeccionais, giseEquipes, giseMembros } from '../../server/schema';
import type { Database } from '../core';

/** Supervisor (DPC) de alguma GISE não finalizada. */
export async function isSupervisorGiseAtiva(db: Database, policialId: number): Promise<boolean> {
	const result = await db
		.select({ id: giseEscalas.id })
		.from(giseEscalas)
		.where(and(ne(giseEscalas.status, 'finalizada'), eq(giseEscalas.supervisor_id, policialId)))
		.limit(1)
		.get();
	return !!result;
}

/**
 * Escalado como membro de equipe em alguma GISE não finalizada — atravessa
 * membro → equipe → seccional → escala, porque a linha de membro não guarda a
 * qual GISE pertence.
 */
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
