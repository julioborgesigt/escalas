import { and, eq, or } from 'drizzle-orm';
import { giseEquipes, giseMembros, giseSeccionais } from './schema';
import type { GiseEscala } from './schema';
import type { Database } from '$lib/db';

/**
 * Um admin seccional/unidade PARTICIPA de uma GISE quando a unidade que ele
 * administra (`papel_unidade_id`) é uma das seccionais (ou unidades
 * operacionais) que compõem a GISE. É o que escopa o acesso por participação
 * (Opção B): em vez de "todo admin vê toda GISE", o admin só acessa as GISEs em
 * que a sua seccional está envolvida. Espelha a regra que a UI já usa para
 * liberar EDIÇÃO por seccional (`sec.seccional_id === papel_unidade_id`).
 */
export async function adminParticipaDaGise(
	db: Database,
	giseId: number,
	papelUnidadeId: number | null | undefined
): Promise<boolean> {
	if (papelUnidadeId == null) return false;
	const row = await db
		.select({ id: giseSeccionais.id })
		.from(giseSeccionais)
		.where(
			and(
				eq(giseSeccionais.gise_id, giseId),
				or(
					eq(giseSeccionais.seccional_id, papelUnidadeId),
					eq(giseSeccionais.unidade_operacional_id, papelUnidadeId)
				)
			)
		)
		.limit(1)
		.get();
	return !!row;
}

/**
 * Verifica se o usuário tem permissão de leitura/download sobre uma escala
 * GISE — paralelo a `verificarPermissaoEscala` (que cuida das escalas
 * regulares).
 *
 * Regras:
 *  - Admin geral → sempre permitido
 *  - Admin seccional/unidade → permitido SE administra uma seccional/unidade
 *    desta GISE (escopo por participação — Opção B; antes era irrestrito)
 *  - Quadro de supervisão da própria GISE (supervisor, assessor, seint1,
 *    seint2) → permitido
 *  - Membro de qualquer equipe desta GISE → permitido
 *  - Demais (incluindo policial de outra unidade) → negado
 *
 * O caller deve passar a entidade `giseEscala` já carregada (`buscarGiseEscala`),
 * para não duplicar query. As checagens de participação e de membro só disparam
 * query quando necessário.
 */
export async function verificarPermissaoGise(
	db: Database,
	gise: GiseEscala,
	u: NonNullable<App.Locals['usuario']>
): Promise<{ permitido: boolean; motivo?: string }> {
	// Admin geral: acesso irrestrito a downloads GISE.
	if (u.tipo === 'admin') return { permitido: true };

	// 1. Quadro de supervisão da própria GISE: supervisor, assessor, SEINT1, SEINT2.
	// Não realiza query ao banco.
	if (u.tipo === 'policial') {
		const quadroIds = [gise.supervisor_id, gise.assessor_id, gise.seint1_id, gise.seint2_id];
		if (quadroIds.includes(u.id)) return { permitido: true };
	}

	// 2. Admin seccional/unidade: escopo por PARTICIPAÇÃO (Opção B). Só acessa GISEs
	// que incluem a seccional/unidade que ele administra — não toda e qualquer.
	if (u.papel === 'admin_seccional' || u.papel === 'admin_unidade') {
		if (u.papel_unidade_id == null) {
			return { permitido: false, motivo: 'Esta GISE não inclui a sua seccional.' };
		}
		if (await adminParticipaDaGise(db, gise.id, u.papel_unidade_id)) {
			return { permitido: true };
		}
		return { permitido: false, motivo: 'Esta GISE não inclui a sua seccional.' };
	}

	// 3. Membro de qualquer equipe da GISE: query mínima em gise_membros.
	if (u.tipo === 'policial') {
		const membro = await db
			.select({ id: giseMembros.id })
			.from(giseMembros)
			.innerJoin(giseEquipes, eq(giseMembros.equipe_id, giseEquipes.id))
			.innerJoin(giseSeccionais, eq(giseEquipes.gise_seccional_id, giseSeccionais.id))
			.where(and(eq(giseMembros.policial_id, u.id), eq(giseSeccionais.gise_id, gise.id)))
			.limit(1)
			.get();

		if (membro) return { permitido: true };
	}

	return { permitido: false, motivo: 'Sem permissão para acessar esta GISE.' };
}
