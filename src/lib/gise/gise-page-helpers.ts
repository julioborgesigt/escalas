/**
 * Helpers PUROS da tela `/gise/[id]` — derivam da GISE já montada
 * (`GiseDetalhado`) as respostas que o markup precisa, sem tocar o banco.
 *
 * Existem fora dos componentes por dois motivos: são compartilhados por
 * `GiseSeccional` e `GiseSupervisao`, e são testáveis sem renderizar nada
 * (`gise-page-helpers.test.ts`). Toda função aqui tolera árvore incompleta —
 * `undefined` em `unidades`/`equipes`/`membros` — porque o `load` degrada quando
 * a migração de slots ainda não rodou no ambiente.
 */
import type {
	GiseDetalhado,
	GiseEquipeComMembros,
	GiseMembro,
	GiseUnidadeSlot
} from '$lib/db/gise';
import type { Unidade } from '$lib/server/schema';

/** Seccional agregada na árvore GISE (equipes e membros). */
type GiseSecComMembros = {
	unidades?: GiseUnidadeSlot[];
};

/** Tipos de equipe com relatório de produtividade, na ordem exibida na UI. */
type GiseEquipeTipo = 'operacional' | 'seint';

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

/**
 * Achata a seccional em uma lista plana de membros (slots → equipes → membros).
 * É a base de `checkAllSigned` e `getFaltandoRubrica`; a tela pergunta sobre "a
 * seccional", não sobre cada equipe.
 */
export function getMembrosFromSec(sec: GiseSecComMembros): GiseMembro[] {
	return (sec.unidades ?? []).flatMap((u: GiseUnidadeSlot) =>
		(u.equipes ?? []).flatMap((eq: GiseEquipeComMembros) => eq.membros ?? [])
	);
}

/**
 * Todos os membros da seccional já rubricaram ENTRADA **e** SAÍDA?
 *
 * Seccional sem membro devolve `false`, não `true`: "vazia" não é "concluída", e
 * o `every` de lista vazia diria o contrário — é exatamente o tipo de resposta
 * que liberaria o encerramento de uma seccional que ninguém preencheu.
 */
export function checkAllSigned(sec: GiseSecComMembros): boolean {
	const members = getMembrosFromSec(sec);
	if (members.length === 0) return false;
	return members.every((m) => m.presenca?.entrada_timestamp && m.presenca?.saida_timestamp);
}

/**
 * Mensagem pronta com quem ainda não rubricou, ou `''` quando não falta ninguém
 * (o chamador testa a string vazia para decidir se mostra o aviso).
 *
 * Só o PRIMEIRO nome de cada faltante: o texto vai num tooltip estreito, e a
 * lista completa de nomes de policiais numa tela compartilhada seria exposição
 * desnecessária.
 */
export function getFaltandoRubrica(sec: GiseSecComMembros): string {
	const members = getMembrosFromSec(sec);
	const faltantes = members.filter(
		(m) => !m.presenca?.entrada_timestamp || !m.presenca?.saida_timestamp
	);
	if (faltantes.length === 0) return '';
	return 'Faltando rubrica de: ' + faltantes.map((m) => m.policial_nome.split(' ')[0]).join(', ');
}

const SECCIONAL_BG_CLASSES: readonly string[] = [
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

/**
 * Cor de borda estável para a seccional — o mesmo id sempre recebe a mesma cor,
 * em qualquer GISE, o que ajuda a reconhecer a seccional de relance.
 *
 * As classes são LITERAIS completas, não montadas por interpolação: o Tailwind
 * varre o código-fonte, e `border-l-${cor}-600` não geraria CSS nenhum.
 */
export function getSeccionalColorClass(seccionalId: number): string {
	return SECCIONAL_BG_CLASSES[seccionalId % SECCIONAL_BG_CLASSES.length];
}

/**
 * Seccionais que ainda PODEM ser adicionadas: as do tipo `seccional` que já não
 * participam desta GISE. Alimenta o `<select>` de "adicionar seccional", e é o
 * que impede o admin de escolher uma duplicata.
 */
export function filtrarSeccionaisDisponiveis(
	gise: GiseDetalhado | null | undefined,
	todasUnidades: Unidade[]
): Unidade[] {
	if (!gise) return [];
	return todasUnidades.filter(
		(u) => u.tipo === 'seccional' && !gise.seccionais.some((s) => s.seccional_id === u.id)
	);
}

/**
 * Só as delegacias — opções de unidade para um slot. Diferente de
 * `filtrarSeccionaisDisponiveis`, NÃO exclui as já escolhidas: a mesma delegacia
 * pode ocupar slots de seccionais diferentes na mesma GISE.
 */
export function filtrarDelegacias(todasUnidades: Unidade[]): Unidade[] {
	return todasUnidades.filter((u) => u.tipo === 'delegacia');
}
