import type { GiseDetalhado } from '$lib/db/gise';

/**
 * Departamento pai ao qual o relatório de extra do quadro de supervisão e apoio fica vinculado
 * (`gise_assinaturas_relatorios.seccional_id` e downloads `seccionalId=`).
 */
export const GISE_SUPERVISAO_EXTRA_DEPARTAMENTO_NOME = 'Departamento de Polícia do Interior Sul';

/**
 * Unidade sintética legada (pré-hierarquia de departamentos). Mantida só para reconhecer IDs
 * antigos em URLs e migração de dados.
 */
export const GISE_SUPERVISAO_EXTRA_UNIDADE_NOME = '__GISE_SUPERVISAO_EXTRA__';

/** Papéis do quadro de supervisão que entram no relatório de extra (presenças). */
export function listarPoliciaisSupervisaoExtra(
	gise: Pick<GiseDetalhado, 'supervisor_id' | 'assessor_id' | 'seint1_id' | 'seint2_id'>
): Array<{ policial_id: number; papel: string }> {
	const out: Array<{ policial_id: number; papel: string }> = [];
	const seen = new Set<number>();
	const push = (id: number | null | undefined, papel: string) => {
		if (id == null) return;
		if (seen.has(id)) return;
		seen.add(id);
		out.push({ policial_id: id, papel });
	};
	push(gise.supervisor_id, 'Supervisor');
	push(gise.assessor_id, 'Assessor');
	push(gise.seint1_id, 'SEINT 1');
	push(gise.seint2_id, 'SEINT 2');
	return out;
}

/**
 * O quadro de supervisão desta GISE deve um relatório? Verdade quando há ao
 * menos um integrante DEFINIDO (supervisor, assessor ou SEINT).
 *
 * É o que decide se o "quadro de supervisão extra" aparece como uma pseudo-
 * seccional pendente: GISE sem quadro nomeado não cobra relatório de ninguém.
 */
export function quadroSupervisaoExtraExigeRelatorio(
	gise: Pick<GiseDetalhado, 'supervisor_id' | 'assessor_id' | 'seint1_id' | 'seint2_id'>
): boolean {
	return listarPoliciaisSupervisaoExtra(gise).length > 0;
}

type PresencaMin = {
	policial_id: number;
	entrada_timestamp: string | null;
	saida_timestamp: string | null;
};

/**
 * Todos os integrantes do quadro (definidos) confirmaram entrada e saída
 * (necessário para liberar o relatório de extra da supervisão).
 */
export function supervisaoExtraPresencasCompletas(
	gise: Pick<GiseDetalhado, 'supervisor_id' | 'assessor_id' | 'seint1_id' | 'seint2_id'>,
	presencas: PresencaMin[]
): boolean {
	const roles = listarPoliciaisSupervisaoExtra(gise);
	if (roles.length === 0) return false;
	const map = new Map(presencas.map((p) => [p.policial_id, p]));
	for (const r of roles) {
		const p = map.get(r.policial_id);
		if (!p?.entrada_timestamp || !p?.saida_timestamp) return false;
	}
	return true;
}

/** Prefixo da mensagem quando faltam confirmações (UI pode colorir só este trecho). */
export const FALTANTE_PRESENCA_SUPER_PREFIX = 'Faltando confirmação de: ';

/**
 * Mensagem de quem, no quadro de supervisão, ainda não confirmou entrada E saída
 * — ou `''` quando não falta ninguém (o chamador testa a string vazia).
 *
 * Só o PRIMEIRO nome de cada faltante, e o papel (`'Assessor'`, `'SEINT 1'`)
 * quando o nome não está no mapa: a mensagem tem de continuar útil mesmo com o
 * cadastro incompleto. O prefixo sai em `FALTANTE_PRESENCA_SUPER_PREFIX` para a
 * UI poder destacar só a parte dos nomes.
 */
export function faltantesSupervisaoExtra(
	gise: Pick<GiseDetalhado, 'supervisor_id' | 'assessor_id' | 'seint1_id' | 'seint2_id'>,
	presencas: PresencaMin[],
	nomePorPolicialId: Map<number, string>
): string {
	const roles = listarPoliciaisSupervisaoExtra(gise);
	const map = new Map(presencas.map((p) => [p.policial_id, p]));
	const falt: string[] = [];
	for (const r of roles) {
		const p = map.get(r.policial_id);
		if (!p?.entrada_timestamp || !p?.saida_timestamp) {
			const nome = nomePorPolicialId.get(r.policial_id) ?? r.papel;
			falt.push(nome.split(' ')[0] ?? nome);
		}
	}
	if (falt.length === 0) return '';
	return FALTANTE_PRESENCA_SUPER_PREFIX + falt.join(', ');
}

type PapelMarcadorSupervisao = 'supervisor' | 'assessor' | 'seint';

type PresencaRodagem = {
	policial_id: number;
	entrada_timestamp: string | null;
	saida_timestamp: string | null;
};

/**
 * Estado do marcador ao lado do nome (alinhado à equipe operacional na GISE).
 * Supervisor/Assessor: ✓ com entrada + saída.
 * SEINT: ✓ com entrada + saída + relatório SEINT (resposta sem `equipe_id`).
 */
export function estadoMarcadorRodagemSupervisao(
	papel: PapelMarcadorSupervisao,
	policialId: number | null | undefined,
	presencas: PresencaRodagem[],
	seintComRelatorioIds: ReadonlySet<number> | number[]
): 'ok' | 'entrada' | 'falta_relatorio' | 'vazio' {
	if (policialId == null) return 'vazio';
	const relSet =
		seintComRelatorioIds instanceof Set ? seintComRelatorioIds : new Set(seintComRelatorioIds);
	const p = presencas.find((x) => x.policial_id === policialId);
	if (!p?.entrada_timestamp) return 'vazio';
	if (!p.saida_timestamp) return 'entrada';
	if (papel === 'seint' && !relSet.has(policialId)) return 'falta_relatorio';
	return 'ok';
}
