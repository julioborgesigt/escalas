/**
 * Recorte POR SECCIONAL depois de `verificarPermissaoGise`.
 *
 * A permissão da GISE prova que a pessoa participa da OPERAÇÃO. Sem um segundo
 * filtro, `?seccionalId=` de outra seccional da mesma GISE entregava o
 * relatório de produtividade alheio (SEC-20). O rascunho do extra já tinha
 * dono (FLW-AUT-008); a produtividade não.
 *
 * Quadro de supervisão e Admin Geral enxergam todas as seccionais da GISE.
 * Admin de unidade/seccional e membro só a que é deles.
 *
 * Módulo puro de propósito: a rota de download e o teste usam a mesma função,
 * sem importar `$lib/server`.
 */

export type RecorteGise = {
	supervisor_id: number | null;
	assessor_id: number | null;
	seint1_id: number | null;
	seint2_id: number | null;
};

export type RecorteSeccional = {
	seccional_id: number;
	unidades?: Array<{
		unidade_id: number | null;
		equipes?: Array<{ membros?: Array<{ policial_id: number }> }>;
	}>;
};

export type RecorteAtor = {
	id: number;
	tipo: string;
	papel_unidade_id?: number | null;
};

export function recorteSeccionalVisivel(
	u: RecorteAtor,
	gise: RecorteGise,
	seccional: RecorteSeccional
): boolean {
	if (u.tipo === 'admin') return true;
	const quadro = [gise.supervisor_id, gise.assessor_id, gise.seint1_id, gise.seint2_id];
	if (quadro.includes(u.id)) return true;
	if (u.papel_unidade_id != null && u.papel_unidade_id === seccional.seccional_id) return true;
	for (const slot of seccional.unidades ?? []) {
		if (u.papel_unidade_id != null && slot.unidade_id === u.papel_unidade_id) return true;
		for (const eq of slot.equipes ?? []) {
			if (eq.membros?.some((m) => m.policial_id === u.id)) return true;
		}
	}
	return false;
}
