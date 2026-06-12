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

/** Tipos de equipe com relatório de produtividade, na ordem exibida na UI. */
export type GiseEquipeTipo = 'operacional' | 'seint';

const ORDEM_TIPOS: readonly GiseEquipeTipo[] = ['operacional', 'seint'];

/**
 * Coleta `operacional` / `seint` presentes nas equipes da seccional.
 * Lê `unidades[].equipes` (modelo atual) e `equipes` no topo (legado).
 * Se ainda não houver equipe, retorna `['operacional']` para exibir o botão desabilitado.
 */
export function tiposEquipeNaSeccional(sec: {
	unidades?: GiseUnidadeSlot[];
	equipes?: GiseEquipeComMembros[];
}): GiseEquipeTipo[] {
	const fromUnidades = (sec.unidades ?? []).flatMap((u) => u.equipes ?? []);
	const legacy = sec.equipes ?? [];
	const present = new Set<GiseEquipeTipo>();
	for (const eq of [...fromUnidades, ...legacy]) {
		if (eq.tipo === 'operacional' || eq.tipo === 'seint') present.add(eq.tipo);
	}
	if (present.size > 0) {
		return ORDEM_TIPOS.filter((t) => present.has(t));
	}
	return ['operacional'];
}

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
	return 'Faltando rubrica de: ' + faltantes.map((m) => m.policial_nome.split(' ')[0]).join(', ');
}

export const SECCIONAL_BG_CLASSES: readonly string[] = [
	'border-l-blue-600 bg-white dark:bg-surface-900',
	'border-l-emerald-600 bg-white dark:bg-surface-900',
	'border-l-indigo-600 bg-white dark:bg-surface-900',
	'border-l-violet-600 bg-white dark:bg-surface-900',
	'border-l-amber-600 bg-white dark:bg-surface-900',
	'border-l-rose-600 bg-white dark:bg-surface-900',
	'border-l-cyan-600 bg-white dark:bg-surface-900',
	'border-l-teal-600 bg-white dark:bg-surface-900',
	'border-l-sky-600 bg-white dark:bg-surface-900',
	'border-l-slate-600 bg-white dark:bg-surface-900'
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
