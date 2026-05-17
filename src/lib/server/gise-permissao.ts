import { and, eq } from 'drizzle-orm';
import { giseEquipes, giseMembros, giseSeccionais } from './schema';
import type { GiseEscala } from './schema';
import type { Database } from '$lib/db';

/**
 * Verifica se o usuário tem permissão de leitura/download sobre uma escala
 * GISE — paralelo a `verificarPermissaoEscala` (que cuida das escalas
 * regulares).
 *
 * Regras:
 *  - Admin geral → sempre permitido
 *  - Admin seccional/unidade → sempre permitido (visibilidade administrativa)
 *  - Quadro de supervisão da própria GISE (supervisor, assessor, seint1,
 *    seint2) → permitido
 *  - Membro de qualquer equipe desta GISE → permitido
 *  - Demais (incluindo policial de outra unidade) → negado
 *
 * O caller deve passar a entidade `giseEscala` já carregada (`buscarGiseEscala`),
 * para não duplicar query. A checagem de membro só dispara uma query extra a
 * `gise_membros` quando o usuário NÃO é admin nem quadro de supervisão.
 */
export async function verificarPermissaoGise(
	db: Database,
	gise: GiseEscala,
	u: NonNullable<App.Locals['usuario']>
): Promise<{ permitido: boolean; motivo?: string }> {
	// Admin geral / seccional / unidade: acesso irrestrito a downloads GISE.
	if (u.tipo === 'admin') return { permitido: true };
	if (u.papel === 'admin_seccional' || u.papel === 'admin_unidade') {
		return { permitido: true };
	}

	// Quadro de supervisão da própria GISE: supervisor, assessor, SEINT1, SEINT2.
	if (u.tipo === 'policial') {
		const quadroIds = [gise.supervisor_id, gise.assessor_id, gise.seint1_id, gise.seint2_id];
		if (quadroIds.includes(u.id)) return { permitido: true };

		// Membro de qualquer equipe da GISE: query mínima em gise_membros.
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
