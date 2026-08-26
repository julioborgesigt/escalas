/**
 * Autorização do domínio GISE: participação (admin seccional/unidade), quadro
 * de supervisão, vínculo de equipe e o portão das rotas de assinatura
 * (`carregarGiseParaAssinatura`). Não há `autorizar()` único — a regra deste
 * domínio mora aqui.
 */
import { and, eq, or } from 'drizzle-orm';
import { giseEquipes, giseMembros, giseSeccionais } from '../schema';
import type { GiseEscala } from '../schema';
import {
	buscarGiseEscala,
	buscarGiseDetalhado,
	buscarGiseDocumento,
	buscarAssinaturaRelatorioGise,
	verificarSaidaCompletaSeccional,
	type Database
} from '$lib/db';
import { badRequest, conflict, forbidden, notFound } from '$lib/server/api';
import { giseAutorizaSeccionalRelatorioExtra, secIdEhSupervisaoExtra } from './supervisao-extra';

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
 * status admite assinatura → **quem chama É o supervisor designado**.
 *
 * Admin Geral NÃO assina a escala GISE, e isso é decisão registrada (ago/2026),
 * não omissão. As cinco rotas divergiam em dois eixos — `finalizar-assinatura`
 * era a única sem a checagem de status, e `preparar-assinatura` a única a
 * recusar admin. A UI decidiu o segundo eixo:
 *
 *   - `SupervisaoDocEscala` libera "Conferência" (download sem assinatura) para
 *     `isSupervisor || isAdminGeral`, mas os botões **"Token"** (A3) e
 *     **"Tela"** (avançada) só para `isSupervisor`;
 *   - `mostrarPainelAssinaturaEscala` = `podeAssinar`, que exige
 *     `gise.supervisor_id === usuarioAtual.id`;
 *   - o texto do próprio card diz "O supervisor poderá assinar a escala…".
 *
 * Ou seja: não existe caminho na interface em que um admin assine a escala
 * GISE. As quatro rotas que aceitavam `u.tipo === 'admin'` permitiam por POST
 * direto o que o produto nunca ofereceu — e esconder o botão não é autorização
 * (ver "Operação material precisa recusar alguém" no `CLAUDE.md`).
 *
 * O relatório por seccional é OUTRO documento, mas hoje segue a MESMA regra:
 * desde ago/2026 as cinco rotas de `relatorios/[seccionalId]/` também exigem o
 * supervisor designado — ver `carregarRelatorioExtraParaAssinatura` abaixo.
 * (Esta frase já disse o contrário; era verdade até aquela remoção.)
 *
 * Devolve `{ gise, id }` ou `{ recusa }` — a rota só repassa a `recusa`.
 */
export async function carregarGiseParaAssinatura(
	db: Database,
	idParam: string | undefined,
	u: NonNullable<App.Locals['usuario']>
): Promise<{ gise: GiseEscala; id: number; recusa?: never } | { recusa: Response; gise?: never }> {
	const id = parseInt(idParam!);
	if (isNaN(id)) return { recusa: badRequest('ID inválido') };

	const gise = await buscarGiseEscala(db, id);
	if (!gise) return { recusa: notFound('Escala GISE') };

	if (gise.status !== 'aguardando_assinatura' && gise.status !== 'em_andamento') {
		return { recusa: badRequest('A escala não está pronta para assinatura') };
	}

	if (gise.supervisor_id !== u.id) {
		return { recusa: forbidden('Apenas o Supervisor designado pode assinar esta escala') };
	}

	if (await buscarGiseDocumento(db, id)) {
		return {
			recusa: conflict('Revogue a assinatura existente antes de assinar novamente')
		};
	}

	return { gise, id };
}

/**
 * PORTÃO das rotas de assinatura AVANÇADA do relatório extraordinário.
 *
 * As três (`assinar`, `preparar-assinatura-avancada`,
 * `finalizar-assinatura-avancada`) repetiam o mesmo preâmbulo palavra por
 * palavra — o `guard:duplicacao` passou a reprovar quando as mensagens foram
 * uniformizadas em ago/2026, e tinha razão: eram três cópias de um gate de
 * autorização, a forma exata que o `CLAUDE.md` manda extrair.
 *
 * A ordem importa e é a mesma que as rotas tinham: papel → ids → GISE existe →
 * supervisor DESIGNADO → seccional pertence a esta GISE → todos confirmaram a
 * saída. A checagem de saída é a mais provável de recusar e vem antes da
 * cerimônia de assinatura, para não queimar a asserção de quem já encostou o
 * dedo no leitor.
 *
 * **Admin Geral não entra** — a regra e o porquê estão em
 * `api/gise/[id]/relatorios/[seccionalId]/preparar-assinatura-avancada`.
 *
 * O par QUALIFICADO (`preparar-assinatura` / `finalizar-assinatura`) aplica a
 * mesma regra de quem-assina, mas NÃO passa por aqui: usa `buscarGiseEscala`
 * (mais leve, não monta o detalhado) e valida seccional/saída pela intenção,
 * não por consulta. Fundir os dois exigiria parametrizar loader e checagens até
 * o helper ficar pior que as duas formas. O que impede as cinco de divergirem
 * é o teste que as nomeia junto, em `e2e/relatorio-extra-gise.spec.ts` — se
 * alguma voltar a aceitar admin, ele reprova.
 *
 * `isSupExtraGate` existe porque o quadro de supervisão é uma "seccional"
 * sintética: quem conta ali são supervisor, assessor e SEINT, não os membros
 * das equipes.
 */
export async function carregarRelatorioExtraParaAssinatura(
	db: Database,
	params: { id?: string; seccionalId?: string },
	u: NonNullable<App.Locals['usuario']>
): Promise<
	| {
			gise: NonNullable<Awaited<ReturnType<typeof buscarGiseDetalhado>>>;
			giseId: number;
			secId: number;
			recusa?: never;
	  }
	| { recusa: Response; gise?: never }
> {
	if (u.tipo !== 'policial') {
		return { recusa: forbidden('Apenas o supervisor designado pode assinar este relatório.') };
	}

	const giseId = parseInt(params.id!);
	const secId = parseInt(params.seccionalId!);
	if (isNaN(giseId) || isNaN(secId)) return { recusa: badRequest('ID inválido') };

	const gise = await buscarGiseDetalhado(db, giseId);
	if (!gise) return { recusa: notFound('Escala') };
	if (gise.supervisor_id !== u.id) {
		return { recusa: forbidden('Apenas o supervisor designado pode assinar este relatório.') };
	}

	if (!(await giseAutorizaSeccionalRelatorioExtra(db, giseId, secId))) {
		return { recusa: badRequest('Seccional inválida para esta GISE.') };
	}

	const isSupExtraGate = await secIdEhSupervisaoExtra(db, secId);
	if (!(await verificarSaidaCompletaSeccional(db, giseId, secId, isSupExtraGate))) {
		return {
			recusa: badRequest(
				'Todos os participantes precisam confirmar a saída antes de assinar o relatório.'
			)
		};
	}

	if (await buscarAssinaturaRelatorioGise(db, giseId, secId, 'extraordinario')) {
		return {
			recusa: conflict('Revogue a assinatura existente antes de assinar novamente')
		};
	}

	return { gise, giseId, secId };
}
