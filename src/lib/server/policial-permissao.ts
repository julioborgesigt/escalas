/**
 * Helpers de escopo administrativo sobre o cadastro de policiais.
 *
 * Modelo:
 *  - Admin Geral: irrestrito (caller recebe `null`).
 *  - admin_seccional: administra a própria seccional + todas as unidades
 *    cuja `seccional_id` é a dela.
 *  - admin_unidade: administra apenas a unidade do PAPEL
 *    (`papel_unidade_id`) — não a lotação atual.
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

/** O nome da unidade, ou `null` se o id não existe. */
async function nomeDaUnidade(db: Database, unidadeId: number): Promise<string | null> {
	const r = await db
		.select({ nome: unidades.nome })
		.from(unidades)
		.where(eq(unidades.id, unidadeId))
		.get();
	return r?.nome ?? null;
}

/**
 * Retorna o conjunto de `lotacao` (nomes de unidade) que o usuário pode
 * administrar. `null` significa "sem restrição" (Admin Geral). Set vazio
 * significa que o usuário não tem escopo algum.
 *
 * **O escopo vem do PAPEL, não da lotação** (FLW-RBAC-003). Até ago/2026
 * `admin_unidade` recebia `new Set([u.lotacao])`, ignorando o
 * `papel_unidade_id` que a concessão exige e persiste. O papel então SEGUIA a
 * pessoa: quem foi nomeado administrador da DP 1 e depois transferido para a
 * DP 5 passava a administrar a DP 5 — uma autoridade que ninguém concedeu, e
 * que aparece sozinha numa movimentação de rotina.
 *
 * Sem `papel_unidade_id` o escopo é VAZIO, não a lotação: cair na lotação é
 * exatamente o defeito. Papel sem unidade é papel sem alcance, e a concessão
 * já recusa criá-lo assim.
 */
export async function lotacoesAdministradas(
	db: Database,
	u: NonNullable<App.Locals['usuario']>
): Promise<Set<string> | null> {
	if (isAdminGeral(u)) return null;
	if (u.papel_unidade_id == null) return new Set();

	if (isAdminSeccional(u)) {
		return new Set(await lotacoesDaSeccional(db, u.papel_unidade_id));
	}
	if (isAdminUnidade(u)) {
		const nome = await nomeDaUnidade(db, u.papel_unidade_id);
		return new Set(nome ? [nome] : []);
	}
	return new Set();
}

/** Aceita `null` (sem restrição) e retorna true para qualquer lotação nesse caso. */
export function lotacaoNoEscopo(escopo: Set<string> | null, lotacao: string): boolean {
	return escopo === null || escopo.has(lotacao);
}

/**
 * A unidade escolhida serve para o papel que está sendo concedido?
 *
 * `papel_unidade_id` é exigido pela tela, mas nunca foi validado: nem que a
 * unidade EXISTA, nem que o tipo dela faça sentido para o papel
 * (FLW-RBAC-003). Um id inexistente produz escopo vazio silencioso — o admin
 * é nomeado, a tela mostra o papel, e ele não administra nada. Um
 * `admin_seccional` apontando para uma DELEGACIA produz escopo de uma unidade
 * só, que é o de `admin_unidade` com outro nome.
 *
 * A regra de tipo é mínima de propósito: só recusa DELEGACIA para
 * `admin_seccional`. Delegacia não tem unidades subordinadas, então o papel
 * não teria o alcance que o nome promete — e para administrar uma unidade
 * isolada já existe `admin_unidade`. Departamento e sub-departamento são
 * aceitos porque a hierarquia os coloca acima da seccional, e há corporação
 * que organiza assim.
 *
 * Devolve `null` quando pode; a mensagem de recusa quando não.
 */
export async function motivoParaRecusarPapel(
	db: Database,
	papel: 'admin_seccional' | 'admin_unidade',
	unidadeId: number
): Promise<string | null> {
	const unidade = await db
		.select({ nome: unidades.nome, tipo: unidades.tipo })
		.from(unidades)
		.where(eq(unidades.id, unidadeId))
		.get();

	if (!unidade) {
		return 'A unidade de responsabilidade escolhida não existe.';
	}
	if (papel === 'admin_seccional' && unidade.tipo === 'delegacia') {
		return (
			`"${unidade.nome}" é uma delegacia e não tem unidades subordinadas — ` +
			'o papel de Admin de Seccional não teria alcance. Use Admin de Unidade.'
		);
	}
	return null;
}
