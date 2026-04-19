import type {
	GiseDetalhado,
	GiseEquipeComMembros,
	GiseMembro,
	GiseUnidadeSlot
} from '$lib/db/gise';
import type { Unidade } from '$lib/server/schema';

/** Seccional agregada na árvore GISE (equipes e membros). */
export type GiseSecComMembros = {
	unidades?: GiseUnidadeSlot[];
};

export function getMembrosFromSec(sec: GiseSecComMembros): GiseMembro[] {
	return (sec.unidades ?? []).flatMap((u: GiseUnidadeSlot) =>
		(u.equipes ?? []).flatMap((eq: GiseEquipeComMembros) => eq.membros ?? [])
	);
}

export function checkAllSigned(sec: GiseSecComMembros): boolean {
	const members = getMembrosFromSec(sec);
	if (members.length === 0) return false;
	return members.every((m) => m.presenca?.entrada_timestamp && m.presenca?.saida_timestamp);
}

export function getFaltandoRubrica(sec: GiseSecComMembros): string {
	const members = getMembrosFromSec(sec);
	const faltantes = members.filter(
		(m) => !m.presenca?.entrada_timestamp || !m.presenca?.saida_timestamp
	);
	if (faltantes.length === 0) return '';
	return (
		'Faltando rubrica de: ' + faltantes.map((m) => m.policial_nome.split(' ')[0]).join(', ')
	);
}

export const SECCIONAL_BG_CLASSES: readonly string[] = [
	'bg-blue-50/50 dark:bg-blue-900/10',
	'bg-emerald-50/50 dark:bg-emerald-900/10',
	'bg-indigo-50/50 dark:bg-indigo-900/10',
	'bg-violet-50/50 dark:bg-violet-900/10',
	'bg-amber-50/50 dark:bg-amber-900/10',
	'bg-rose-50/50 dark:bg-rose-900/10',
	'bg-cyan-50/50 dark:bg-cyan-900/10',
	'bg-teal-50/50 dark:bg-teal-900/10',
	'bg-sky-50/50 dark:bg-sky-900/10',
	'bg-slate-50/50 dark:bg-slate-900/10'
];

export function getSeccionalColorClass(seccionalId: number): string {
	return SECCIONAL_BG_CLASSES[seccionalId % SECCIONAL_BG_CLASSES.length];
}

export function filtrarSeccionaisDisponiveis(
	gise: GiseDetalhado | null | undefined,
	todasUnidades: Unidade[]
): Unidade[] {
	if (!gise) return [];
	return todasUnidades.filter(
		(u) => u.tipo === 'seccional' && !gise.seccionais.some((s) => s.seccional_id === u.id)
	);
}

export function filtrarDelegacias(todasUnidades: Unidade[]): Unidade[] {
	return todasUnidades.filter((u) => u.tipo === 'delegacia');
}
