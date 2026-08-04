/**
 * Helpers de escopo administrativo sobre o cadastro de policiais.
 *
 * Modelo:
 *  - Admin Geral: irrestrito (caller recebe `null`).
 *  - admin_seccional: administra a própria seccional + todas as unidades
 *    cuja `seccional_id` é a dela.
 *  - admin_unidade: administra apenas a própria `u.lotacao`.
 *  - Demais (policial sem papel): nada — caller deve barrar antes.
 *
 * Use em conjunto com `isAnyAdmin` para guarda de rota; este módulo cuida
 * apenas do recorte de "quais lotações o admin pode tocar".
 */

import { eq, or } from 'drizzle-orm';
import { unidades } from '$lib/server/schema';
import { isAdminGeral, isAdminSeccional, isAdminUnidade } from '$lib/auth';
import type { Database } from '$lib/db';

/**
 * Nomes da unidade `seccionalId` MAIS os das unidades subordinadas a ela — o
 * recorte de "a seccional e as delegacias abaixo dela".
 *
 * Devolve NOME, não id, porque é assim que policiais e escalas se ligam à
 * unidade (`policiais.lotacao`, `escalas.lotacao` — ver o cabeçalho de
 * `$lib/db/unidades`). Um id sem correspondência devolve `[]`.
 *
 * Existe separado de `lotacoesAdministradas` porque os call sites divergem no
 * que fazem com os OUTROS papéis — a listagem de escalas converte
 * `admin_unidade` num filtro de lotação única, e o poll de `/api/sync/estado`
 * nem precisa dele —, mas todos precisam desta mesma expansão. Antes de ser
 * extraída, ela estava reescrita em três lugares além daqui.
 */
export async function lotacoesDaSeccional(db: Database, seccionalId: number): Promise<string[]> {
	const rows = await db
		.select({ nome: unidades.nome })
		.from(unidades)
		.where(or(eq(unidades.id, seccionalId), eq(unidades.seccional_id, seccionalId)))
		.all();
	return rows.map((r) => r.nome);
}

/**
 * Retorna o conjunto de `lotacao` (nomes de unidade) que o usuário pode
 * administrar. `null` significa "sem restrição" (Admin Geral). Set vazio
 * significa que o usuário não tem escopo algum.
 */
export async function lotacoesAdministradas(
	db: Database,
	u: NonNullable<App.Locals['usuario']>
): Promise<Set<string> | null> {
	if (isAdminGeral(u)) return null;
	if (isAdminSeccional(u) && u.papel_unidade_id != null) {
		return new Set(await lotacoesDaSeccional(db, u.papel_unidade_id));
	}
	if (isAdminUnidade(u) && u.lotacao) {
		return new Set([u.lotacao]);
	}
	return new Set();
}

/** Aceita `null` (sem restrição) e retorna true para qualquer lotação nesse caso. */
export function lotacaoNoEscopo(escopo: Set<string> | null, lotacao: string): boolean {
	return escopo === null || escopo.has(lotacao);
}
