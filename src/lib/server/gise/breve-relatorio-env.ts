import { buscarConfiguracao } from '$lib/db/configuracoes';
import type { Database } from '$lib/db/core';
import type { BreveRelatorioEnv } from '$lib/gise/breve-relatorio';

/**
 * Chaves em `configuracoes` (página **Config. GISE**), aplicáveis a todas as escalas salvo
 * as colunas `breve_relatorio_*` nessa GISE.
 */
export const GISE_BREVE_RELATORIO_CONFIG_KEYS = {
	titulo: 'gise_breve_relatorio_titulo',
	textoSeccional: 'gise_breve_relatorio_texto_seccional',
	textoSupervisao: 'gise_breve_relatorio_texto_supervisao'
} as const;

const K = GISE_BREVE_RELATORIO_CONFIG_KEYS;

function cfg(v: string | null | undefined): string | undefined {
	const t = v?.trim();
	return t ? t : undefined;
}

/**
 * Texto global do breve relatório: só entradas em `configuracoes` (Config. GISE).
 * `resolveBreveRelatorio*` combina: colunas da GISE → este objeto → constantes no código.
 */
export async function getBreveRelatorioEnvMergido(db: Database): Promise<BreveRelatorioEnv> {
	const [t, s, u] = await Promise.all([
		buscarConfiguracao(db, K.titulo),
		buscarConfiguracao(db, K.textoSeccional),
		buscarConfiguracao(db, K.textoSupervisao)
	]);
	return {
		GISE_BREVE_RELATORIO_TITULO: cfg(t),
		GISE_BREVE_RELATORIO_TEXTO_SECCIONAL: cfg(s),
		GISE_BREVE_RELATORIO_TEXTO_SUPERVISAO: cfg(u)
	};
}
