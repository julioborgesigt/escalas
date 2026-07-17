/**
 * Exclusão COMPLETA de uma escala mensal: objetos no R2 (blob assinado +
 * cópia de conferência + selfie), linha do documento e a própria escala —
 * nesta ordem, porque o cascade da FK apagaria o `r2_key` antes da limpeza
 * e deixaria os objetos órfãos e irrastreáveis (R2-1/R2-3).
 *
 * Caminho único de exclusão de escala. Antes, três call sites (/escalas,
 * /recebidos, /painel) repetiam a sequência à mão e o do /painel divergiu,
 * excluindo sem limpar o R2 (auditoria 2026-07-16, achado B-3).
 */

import { excluirEscala, excluirDocumentoEscala, getR2, hasR2 } from '$lib/db';
import type { Database } from '$lib/db';
import { limparR2DocumentoEscala } from './r2-cleanup';

export async function excluirEscalaCompleta(
	db: Database,
	platform: App.Platform | undefined,
	escalaId: number
): Promise<void> {
	if (hasR2(platform)) {
		await limparR2DocumentoEscala(db, getR2(platform), escalaId);
	}
	await excluirDocumentoEscala(db, escalaId);
	await excluirEscala(db, escalaId);
}
