import type { GiseDetalhado } from '$lib/db/gise';

/** Nome único da unidade “virtual” usada em `gise_assinaturas_relatorios.seccional_id`. */
export const GISE_SUPERVISAO_EXTRA_UNIDADE_NOME = '__GISE_SUPERVISAO_EXTRA__';

/** Papéis do quadro de supervisão que entram no relatório de extra (presenças). */
export function listarPoliciaisSupervisaoExtra(gise: Pick<
	GiseDetalhado,
	'supervisor_id' | 'assessor_id' | 'seint1_id' | 'seint2_id'
>): Array<{ policial_id: number; papel: string }> {
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

export function quadroSupervisaoExtraExigeRelatorio(gise: Pick<
	GiseDetalhado,
	'supervisor_id' | 'assessor_id' | 'seint1_id' | 'seint2_id'
>): boolean {
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
export function supervisaoExtraRubricasCompletas(
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
	return 'Faltando rubrica de: ' + falt.join(', ');
}

export type PapelMarcadorSupervisao = 'supervisor' | 'assessor' | 'seint';

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
