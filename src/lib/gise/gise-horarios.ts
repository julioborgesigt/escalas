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

export function horaToMin(h: string): number {
	const [hh, mm] = h.split(':').map(Number);
	return hh * 60 + (mm || 0);
}

/**
 * Verifica se dois intervalos de horário se sobrepõem.
 * Lida com turnos que cruzam a meia-noite (ex: 22:00–06:00).
 */
export function seOverlapam(e1: string, s1: string, e2: string, s2: string): boolean {
	const a = horaToMin(e1); let b = horaToMin(s1);
	const c = horaToMin(e2); let d = horaToMin(s2);
	if (b <= a) b += 1440;
	if (d <= c) d += 1440;
	return (a < d && c < b) || (a < d + 1440 && c + 1440 < b);
}
