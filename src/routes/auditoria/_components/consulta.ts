/**
 * Paginação e normalização de intervalo de data, comuns a `/auditoria` e
 * `/auditoria/logs` — os dois consoles de Super Admin que paginam por GET.
 */

export const PER_PAGE = 25;

/** `ate` só com data (10 chars) vira fim do dia, para o intervalo ser inclusivo. */
export function fimDoDia(s: string | null): string | undefined {
	if (!s) return undefined;
	return s.length === 10 ? `${s} 23:59:59` : s;
}
