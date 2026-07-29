/**
 * Utilitários comuns às form actions de `/gise/[id]` (equipes, membros,
 * seccionais e unidades).
 */

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
