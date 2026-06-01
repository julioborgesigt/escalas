/**
 * Título e textos padrão do bloco "Breve relatório" nos PDFs de serviço extraordinário (GISE).
 *
 * Ordem: colunas `breve_relatorio_*` em `gise_escalas` (por escala) → chaves em `configuracoes` (**Config. GISE**)
 * → constantes abaixo.
 */

import type { GiseEscala } from '$lib/server/schema';

export const DEFAULT_BREVE_RELATORIO_TITULO = 'BREVE RELATÓRIO:';

export const DEFAULT_BREVE_RELATORIO_TEXTO_SECCIONAL =
	'EM RAZÃO DE SERVIÇO EXTRAORDINÁRIO (GISE) OS SERVIDORES ABAIXO RELACIONADOS RECEBERÃO GRATIFICAÇÃO NA FORMA DE DIÁRIAS DE REFORÇO OPERACIONAL.';

export const DEFAULT_BREVE_RELATORIO_TEXTO_SUPERVISAO =
	'EM RAZÃO DE SERVIÇO EXTRAORDINÁRIO (GISE) OS SERVIDORES DO QUADRO DE SUPERVISÃO ABAIXO RELACIONADOS RECEBERÃO GRATIFICAÇÃO NA FORMA DE DIÁRIAS DE REFORÇO OPERACIONAL.';

/** Valores globais (Config. GISE em `configuracoes`); o nome remete ao histórico, não a env vars. */
export type BreveRelatorioEnv = {
	GISE_BREVE_RELATORIO_TITULO?: string;
	GISE_BREVE_RELATORIO_TEXTO_SECCIONAL?: string;
	GISE_BREVE_RELATORIO_TEXTO_SUPERVISAO?: string;
};

type GiseBrevePick = Pick<
	GiseEscala,
	'breve_relatorio_titulo' | 'breve_relatorio_texto_seccional' | 'breve_relatorio_texto_supervisao'
>;

function primeiroTextoNaoVazio(...candidatos: (string | null | undefined)[]): string | undefined {
	for (const c of candidatos) {
		const t = c?.trim();
		if (t) return t;
	}
	return undefined;
}

/** Rótulo exibido acima da caixa de texto (ambos os PDFs de extra). */
export function resolveBreveRelatorioTitulo(
	gise: GiseBrevePick,
	global?: BreveRelatorioEnv | null
): string {
	return (
		primeiroTextoNaoVazio(gise.breve_relatorio_titulo, global?.GISE_BREVE_RELATORIO_TITULO) ??
		DEFAULT_BREVE_RELATORIO_TITULO
	);
}

/** Parágrafo padrão no relatório de extra por seccional. */
export function resolveBreveRelatorioConteudoSeccional(
	gise: GiseBrevePick,
	global?: BreveRelatorioEnv | null
): string {
	return (
		primeiroTextoNaoVazio(
			gise.breve_relatorio_texto_seccional,
			global?.GISE_BREVE_RELATORIO_TEXTO_SECCIONAL
		) ?? DEFAULT_BREVE_RELATORIO_TEXTO_SECCIONAL
	);
}

/** Parágrafo padrão no relatório de extra do quadro de supervisão. */
export function resolveBreveRelatorioConteudoSupervisao(
	gise: GiseBrevePick,
	global?: BreveRelatorioEnv | null
): string {
	return (
		primeiroTextoNaoVazio(
			gise.breve_relatorio_texto_supervisao,
			global?.GISE_BREVE_RELATORIO_TEXTO_SUPERVISAO
		) ?? DEFAULT_BREVE_RELATORIO_TEXTO_SUPERVISAO
	);
}
