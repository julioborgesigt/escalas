/**
 * Autorização do domínio GISE: participação (admin seccional/unidade), quadro
 * de supervisão, vínculo de equipe e o portão das rotas de assinatura
 * (`carregarGiseParaAssinatura`). Não há `autorizar()` único — a regra deste
 * domínio mora aqui.
 */
import { and, eq, or } from 'drizzle-orm';
import { giseEquipes, giseMembros, giseSeccionais } from '../schema';
import type { GiseEscala } from '../schema';
import { buscarGiseEscala, type Database } from '$lib/db';
import { badRequest, forbidden, notFound } from '$lib/server/api';

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

/**
 * Portão das cinco rotas de assinatura da GISE (`assinar-simples`, os dois
 * passos da avançada e os dois da qualificada): id válido → GISE existe →
 * status admite assinatura → quem chama pode assinar.
 *
 * As cinco rodavam a mesma sequência copiada, e a cópia divergiu num ponto que
 * a leitura lado a lado revela: **`preparar-assinatura` é a única que NÃO
 * admite Admin Geral.** As outras quatro liberam `u.tipo === 'admin'`.
 *
 * A divergência é contraditória com ela mesma, e é por isso que ela está aqui
 * como parâmetro NOMEADO em vez de resolvida em silêncio: `preparar-assinatura`
 * emite a intenção que `finalizar-assinatura` consome, então um admin nunca
 * obtém intenção para o fluxo qualificado — o que torna a permissão de admin
 * do `finalizar` **inalcançável**. Uma das duas está errada:
 *
 *   - se assinar GISE com token A3 é ato pessoal do supervisor designado, o
 *     `finalizar` é que deveria recusar admin (hoje aceita, sem efeito);
 *   - se o Admin Geral pode assinar, o `preparar` é que perdeu a cláusula.
 *
 * Não é decisão de refatoração: mudar qualquer um dos lados MUDA quem assina um
 * documento com valor jurídico. Até que alguém decida, o portão preserva o
 * comportamento de cada rota, e `admitirAdmin: false` marca a exceção no lugar
 * onde ela pode ser vista — em vez de numa quinta cópia onde ninguém a compara.
 *
 * Devolve `{ gise, id }` ou `{ recusa }` — a rota só repassa a `recusa`.
 *
 * @param admitirAdmin `true` (padrão) libera `u.tipo === 'admin'` além do
 *   supervisor designado. `preparar-assinatura` passa `false`.
 */
export async function carregarGiseParaAssinatura(
	db: Database,
	idParam: string | undefined,
	u: NonNullable<App.Locals['usuario']>,
	opts: { admitirAdmin?: boolean } = {}
): Promise<{ gise: GiseEscala; id: number; recusa?: never } | { recusa: Response; gise?: never }> {
	const admitirAdmin = opts.admitirAdmin ?? true;

	const id = parseInt(idParam!);
	if (isNaN(id)) return { recusa: badRequest('ID inválido') };

	const gise = await buscarGiseEscala(db, id);
	if (!gise) return { recusa: notFound('Escala GISE') };

	if (gise.status !== 'aguardando_assinatura' && gise.status !== 'em_andamento') {
		return { recusa: badRequest('A escala não está pronta para assinatura') };
	}

	const ehAdminLiberado = admitirAdmin && u.tipo === 'admin';
	if (!ehAdminLiberado && gise.supervisor_id !== u.id) {
		return {
			recusa: forbidden(
				admitirAdmin
					? 'Apenas o supervisor designado ou administradores podem assinar'
					: 'Apenas o Supervisor designado pode assinar esta escala'
			)
		};
	}

	return { gise, id };
}
