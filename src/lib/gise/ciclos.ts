/**
 * Ciclo GISE — o período de fechamento da diária extra.
 *
 * Não é o mês civil: vai do dia **21 do mês anterior** ao **dia 20** do mês que
 * dá nome ao ciclo (ciclo 7 = 21/jun a 20/jul). O ciclo 1 atravessa a virada do
 * ano (21/dez do ano anterior a 20/jan).
 *
 * A regra do INTERVALO estava escrita duas vezes — no filtro do histórico
 * (`SecaoHistorico`) e no endpoint de exportação —, o que arriscava divergência
 * entre o que a tela lista e o que o arquivo exporta. O predicado agora mora
 * em `historico-filtro.ts` e chama esta função.
 */

/** Intervalo fechado [inicio, fim] do ciclo, em datas ISO (`YYYY-MM-DD`). */
export function getCicloRange(ano: number, ciclo: number): { inicio: string; fim: string } {
	if (ciclo === 1) return { inicio: `${ano - 1}-12-21`, fim: `${ano}-01-20` };
	const mI = String(ciclo - 1).padStart(2, '0');
	const mF = String(ciclo).padStart(2, '0');
	return { inicio: `${ano}-${mI}-21`, fim: `${ano}-${mF}-20` };
}

/**
 * Qual ciclo contém esta data civil (`YYYY-MM-DD`)?
 *
 * Dia 21 ou depois entra no ciclo do mês seguinte — em dezembro, no ciclo 1
 * do ano seguinte. Dia 20 ou antes fica no ciclo que termina naquele mês.
 */
export function cicloQueContem(isoDia: string): { ano: number; ciclo: number } {
	const ano = Number(isoDia.slice(0, 4));
	const mes = Number(isoDia.slice(5, 7));
	const dia = Number(isoDia.slice(8, 10));
	if (dia >= 21) {
		return mes === 12 ? { ano: ano + 1, ciclo: 1 } : { ano, ciclo: mes + 1 };
	}
	return { ano, ciclo: mes };
}

/** Anos vizinhos do ciclo corrente, para o seletor do histórico. */
export function anosParaSeletorCiclo(hojeISO: string): number[] {
	const { ano } = cicloQueContem(hojeISO);
	return [ano - 2, ano - 1, ano, ano + 1];
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
