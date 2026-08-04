/**
 * Utilitários comuns às form actions de `/gise/[id]` (equipes, membros,
 * seccionais e unidades).
 */
import { isAdminGeral, isAdminSeccional } from '$lib/auth';

/**
 * Quem pode PREENCHER uma seccional da GISE: o Admin Geral, em qualquer uma, e
 * o admin da própria seccional, só na dela.
 *
 * Até ago/2026 as quatro actions que preenchem seccional — `adicionarMembro`,
 * `removerMembro`, `finalizarSeccional` e `salvarHorariosSec` — escreviam cada
 * uma a METADE de baixo desta regra:
 *
 *     if (isAdminSeccional(u) && u.papel_unidade_id !== sec.seccional_id)
 *         return fail(403, ...)
 *
 * O 403 só disparava para quem JÁ era admin de seccional. Policial comum — de
 * qualquer unidade, sem papel nenhum — atravessava o guard inteiro e montava
 * equipe de seccional alheia por POST direto (FLW-GISE-004). A tela nunca
 * ofereceu isso: `podeEditarMembros` e o botão de horários exigem
 * `isAdminGeral || (isSeccional && a própria seccional)`, e é essa a regra
 * escrita aqui.
 *
 * Quatro cópias da mesma meia-regra, e nenhuma delas errada sozinha — o erro
 * estava no que faltava nas quatro. Por isso a regra virou UMA função: quem
 * ganhar a quinta action não tem como escrever só a metade.
 */
export function podePreencherSeccional(
	u: App.Locals['usuario'],
	seccionalId: number | null | undefined
): boolean {
	if (!u) return false;
	if (isAdminGeral(u)) return true;
	return isAdminSeccional(u) && u.papel_unidade_id != null && u.papel_unidade_id === seccionalId;
}

/** Lê um campo do FormData como inteiro; devolve `NaN` quando ausente/inválido. */
export function getInt(fd: FormData, key: string): number {
	const v = fd.get(key);
	if (v === null || v === undefined) return NaN;
	return parseInt(v as string);
}

/** Status em que a GISE ainda é rascunho: montar e remexer a escala é livre. */
const STATUS_FASE_EDICAO = ['em_definicao_supervisor', 'em_preenchimento'];

/**
 * A GISE já passou da fase de rascunho?
 *
 * Depois disso o PDF da escala pode ter sido gerado e assinado, então qualquer
 * mudança de composição precisa invalidar o que ficou para trás. Há duas
 * estratégias, conforme o alcance da mudança:
 *
 * - mexeu na escala inteira (slots, nova equipe, remoção de seccional) → apaga
 *   `gise_documentos` e devolve o status para `em_preenchimento`;
 * - mexeu só numa seccional (horários, membros, remoção de equipe/unidade) →
 *   `revogarAssinaturasSeccional`, preservando o restante.
 */
export function saiuDaFaseDeEdicao(status: string): boolean {
	return !STATUS_FASE_EDICAO.includes(status);
}
