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
	'bg-blue-100/65 dark:bg-blue-900/15',
	'bg-emerald-100/65 dark:bg-emerald-900/15',
	'bg-indigo-100/65 dark:bg-indigo-900/15',
	'bg-violet-100/65 dark:bg-violet-900/15',
	'bg-amber-100/65 dark:bg-amber-900/15',
	'bg-rose-100/65 dark:bg-rose-900/15',
	'bg-cyan-100/65 dark:bg-cyan-900/15',
	'bg-teal-100/65 dark:bg-teal-900/15',
	'bg-sky-100/65 dark:bg-sky-900/15',
	'bg-slate-200/65 dark:bg-slate-800/20'
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
