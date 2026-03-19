/**
 * Remove pontos e hifens da matrícula para padronização.
 * Ex: "301.095-1-1" -> "30109511"
 */
export function limparMatricula(matricula: string): string {
	if (!matricula) return '';
	return String(matricula).replace(/[.-]/g, '').trim();
}
