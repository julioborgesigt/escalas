import { formatarData, calcularDataSaida, DIAS_SEMANA_CURTO } from '$lib/utils/datas';
import type { Escala } from '$lib/server/schema';
import type { EscalaPolicialComDados } from '$lib/types';

/**
 * Helpers de horário/data de um servidor na escala, com fallback para os
 * horários padrão da própria escala. Compartilhados por `ListaFds` e
 * `TabelaServidores` (antes cada um tinha uma cópia). Factory com getter para
 * a escala manter a reatividade de props do Svelte 5.
 */
export function criarHelpersHorario(getEscala: () => Escala | null | undefined) {
	function getHoraEntrada(p: EscalaPolicialComDados): string {
		return p.hora_entrada || getEscala()?.hora_entrada || '08';
	}

	function getHoraSaida(p: EscalaPolicialComDados): string {
		return p.hora_saida || getEscala()?.hora_saida || '08';
	}

	function getDataSaida(p: EscalaPolicialComDados): string {
		if (p.data_saida) return p.data_saida;
		return calcularDataSaida(p.data_plantao, getHoraEntrada(p), getHoraSaida(p));
	}

	function formatarHorario(p: EscalaPolicialComDados): string {
		return `${getHoraEntrada(p)}H A ${getHoraSaida(p)}H`;
	}

	function formatarDataPlantao(p: EscalaPolicialComDados): string {
		const de = formatarData(p.data_plantao);
		const ds = getDataSaida(p);
		if (ds !== p.data_plantao) return `${de} à ${formatarData(ds)}`;
		return de;
	}

	return { getHoraEntrada, getHoraSaida, getDataSaida, formatarHorario, formatarDataPlantao };
}

/** Rótulo curto do dia da semana de uma data ISO. */
export function diaSemanaLabel(iso: string): string {
	return DIAS_SEMANA_CURTO[new Date(iso + 'T12:00:00').getDay()];
}
