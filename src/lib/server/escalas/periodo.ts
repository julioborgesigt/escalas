/**
 * O dia lançado pertence ao período da escala? — FLW-ESC-005.
 *
 * As datas chegam do CLIENTE: `data_plantao` num campo do formulário,
 * `datas` num JSON oculto montado pelo calendário do modal. Nada no servidor
 * conferia se elas caem dentro de `[data_inicio, data_fim]` — e o calendário,
 * que é a única coisa que limitava, é markup.
 *
 * O efeito de um POST direto não é um erro visível: a linha entra, some da
 * grade (que só desenha os dias do mês) e reaparece no PDF, que lista o que o
 * banco tem. Uma escala de setembro assinada com um plantão de agosto.
 *
 * Módulo separado e PURO porque quatro actions precisam da mesma resposta —
 * `adicionar`, `adicionarPlantao`, `repetir` e `editar`. Escrita à mão em
 * quatro lugares, a regra falta em algum.
 *
 * Comparação lexicográfica de `YYYY-MM-DD`: com zero à esquerda ela é
 * equivalente à cronológica, e evita `new Date()`, que interpretaria a string
 * como UTC e deslocaria o dia em UTC-3.
 */

/** O intervalo de uma escala, como as colunas o guardam. */
export interface PeriodoDaEscala {
	data_inicio: string;
	data_fim: string;
}

/** `true` quando `data` (YYYY-MM-DD) está dentro do período, incluídas as bordas. */
export function dataNoPeriodo(escala: PeriodoDaEscala, data: string): boolean {
	if (!data) return false;
	return data >= escala.data_inicio && data <= escala.data_fim;
}

/**
 * As datas de FORA do período, na ordem em que vieram — vazio quando todas
 * cabem.
 *
 * Devolve a lista, e não um booleano, porque a mensagem precisa DIZER quais:
 * o operador que colou trinta dias e recebe "há datas fora do período" não
 * descobre qual corrigir.
 */
export function datasForaDoPeriodo(escala: PeriodoDaEscala, datas: string[]): string[] {
	return datas.filter((d) => !dataNoPeriodo(escala, d));
}

/** `dd/mm, dd/mm` — o formato com que a tela fala de datas. */
export function formatarDiasBR(datas: string[]): string {
	return datas
		.map((d) => {
			const [, m, dia] = d.split('-');
			return m && dia ? `${dia}/${m}` : d;
		})
		.join(', ');
}

/**
 * A mensagem de recusa pronta, ou `null` quando está tudo dentro do período.
 *
 * Concentra também o TEXTO: quatro actions repetindo a frase divergiriam nela
 * antes de divergirem na regra.
 */
export function erroDeDatasForaDoPeriodo(escala: PeriodoDaEscala, datas: string[]): string | null {
	const fora = datasForaDoPeriodo(escala, datas);
	if (fora.length === 0) return null;
	return (
		`Data(s) fora do período desta escala (${formatarDiasBR([escala.data_inicio])} a ` +
		`${formatarDiasBR([escala.data_fim])}): ${formatarDiasBR(fora)}.`
	);
}
