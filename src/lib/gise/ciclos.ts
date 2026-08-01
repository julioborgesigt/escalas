/**
 * Ciclo GISE — o período de fechamento da diária extra.
 *
 * Não é o mês civil: vai do dia **21 do mês anterior** ao **dia 20** do mês que
 * dá nome ao ciclo (ciclo 7 = 21/jun a 20/jul). O ciclo 1 atravessa a virada do
 * ano (21/dez do ano anterior a 20/jan).
 *
 * A regra estava escrita duas vezes — no filtro do histórico (`SecaoHistorico`)
 * e no endpoint de exportação —, o que arriscava divergência entre o que a tela
 * lista e o que o arquivo exporta.
 */

/** Intervalo fechado [inicio, fim] do ciclo, em datas ISO (`YYYY-MM-DD`). */
export function getCicloRange(ano: number, ciclo: number): { inicio: string; fim: string } {
	if (ciclo === 1) return { inicio: `${ano - 1}-12-21`, fim: `${ano}-01-20` };
	const mI = String(ciclo - 1).padStart(2, '0');
	const mF = String(ciclo).padStart(2, '0');
	return { inicio: `${ano}-${mI}-21`, fim: `${ano}-${mF}-20` };
}

const ABREV_MES = [
	'Jan',
	'Fev',
	'Mar',
	'Abr',
	'Mai',
	'Jun',
	'Jul',
	'Ago',
	'Set',
	'Out',
	'Nov',
	'Dez'
];

/** Opções do seletor de ciclo: `{ n: 7, label: 'Ciclo 7 (21/Jun – 20/Jul)' }`. */
export const CICLOS = Array.from({ length: 12 }, (_, i) => {
	const n = i + 1;
	// Mês anterior ao do ciclo; no ciclo 1 é dezembro.
	const inicio = ABREV_MES[(n + 10) % 12];
	const fim = ABREV_MES[n - 1];
	// `padEnd(2)` mantém o alinhamento da coluna "(21/…" no dropdown entre os
	// ciclos de 1 e 2 dígitos.
	return { n, label: `Ciclo ${String(n).padEnd(2)} (21/${inicio} – 20/${fim})` };
});
