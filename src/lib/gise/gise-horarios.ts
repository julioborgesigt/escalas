/**
 * Helpers puros para validação e normalização de horários HH:MM.
 * Extraídos de `src/routes/gise/[id]/+page.svelte`.
 */

export function normalizarHora(v: string): string | null {
	if (!v) return null;
	return v.replace(/[.,]/g, ':');
}

export function validarHora(v: string): boolean {
	if (!v) return true;
	return /^\d{1,2}:\d{2}$/.test(normalizarHora(v) ?? '');
}
