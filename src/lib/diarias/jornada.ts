/**
 * A missão de UM DIA extrapolou a jornada ordinária de 8 horas?
 *
 * É a pergunta que decide a meia diária quando não há pernoite. Com pernoite a
 * quantidade sai do calendário (`$lib/diarias/contagem`) e esta função não é
 * consultada.
 *
 * ## A ordem de prioridade é do decreto, e é o que mais importa aqui
 *
 * O Decreto nº 35.922/2024 verifica nesta sequência:
 *
 * 1. **Dia pago** — fim de semana ou feriado. Extrapolação PRESUMIDA pelo art.
 *    22, sem olhar horário nenhum.
 * 2. **Horário declarado** — saída de madrugada (antes das 6h) ou retorno
 *    noturno (após as 18h).
 * 3. **Cálculo estimado** — `2 × tempo de ida + 3h de permanência > 8h`.
 *
 * O passo 3 é **subsidiário**: o texto o condiciona a "caso não haja declaração
 * expressa de horários". Ele NÃO reexamina horário declarado que já foi
 * analisado no passo 2 — declarou e não extrapolou é `'nao'`, não "vamos
 * estimar". Inverter isso mudaria o resultado de missões reais, e para mais.
 *
 * **Consequência prática, que vale registrar:** no plano operacional o horário é
 * sempre declarado, e a operação corre das 04h às 08h — saída antes das 6h.
 * Toda equipe cai no passo 2 e extrapola, a 20 km ou a 300 km. O passo 3 é
 * inalcançável ali; ele existe para a solicitação avulsa de diária, onde o
 * requerimento pode vir sem horários.
 *
 * ## As 3h de permanência são uma PRESUNÇÃO, e a real é outra
 *
 * A operação do DPI SUL dura 4h. Trocando a presunção pelo número real, o teste
 * `2×ida + 4h > 8h` equivale a `ida > 2h` — que nas estradas do Ceará cai perto
 * de 100 km, e é de onde vem o limite de `$lib/planos/custeio`. Aqui fica a
 * presunção do decreto, porque é ela que vale quando não há horário declarado;
 * a permanência real vive do lado do plano, que a conhece.
 */

/**
 * Jornada ordinária diária, em horas — o que a missão precisa ultrapassar.
 *
 * Não exportadas, estas duas: elas descrevem o CÁLCULO, e quem consome o módulo
 * consome o resultado (`Extrapolacao`). Publicá-las convidaria um call site a
 * refazer a conta por fora, que é como duas versões da mesma regra nascem.
 */
const JORNADA_ORDINARIA_HORAS = 8;

/** Permanência PRESUMIDA em diligência, em horas, no cálculo estimado. */
const PERMANENCIA_PRESUMIDA_HORAS = 3;

/** Antes desta hora a saída é "de madrugada" e extrapola. */
const HORA_SAIDA_MADRUGADA = 6;

/** Depois desta hora o retorno é "noturno" e extrapola. */
const HORA_RETORNO_NOTURNO = 18;

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const HORA = /^(\d{1,2}):(\d{2})$/;

/**
 * Como a jornada foi (ou não) extrapolada — e por qual dos caminhos do decreto,
 * porque o parecer precisa citar o que o sustentou.
 */
export type Extrapolacao =
	/** Fim de semana ou feriado: presunção do art. 22. */
	| 'dia_pago'
	/** Saída antes das 6h ou retorno após as 18h, conforme declarado. */
	| 'horario_declarado'
	/** Sem horário declarado: `2×ida + 3h` passou de 8h. */
	| 'estimada'
	/** Não extrapolou. */
	| 'nao'
	/** Sem horário declarado E sem tempo de viagem — não dá para decidir. */
	| 'indeterminada';

/** A missão de um dia, como esta regra a enxerga. */
export interface JanelaDaMissao {
	/** `YYYY-MM-DD` do dia da missão. */
	data: string;
	/** O dia é feriado. Fim de semana sai do calendário e não precisa ser dito. */
	feriado?: boolean;
	/** `HH:MM` — ausente quando o requerimento não declarou horários. */
	horaInicio?: string | null;
	horaFim?: string | null;
	/** Tempo de IDA em minutos, para o cálculo estimado. `null` quando não medido. */
	minutosIda?: number | null;
}

/** Minutos desde a meia-noite, ou `null` se não for `HH:MM` válida. */
function minutosDoDia(hora: string | null | undefined): number | null {
	const m = HORA.exec((hora ?? '').trim());
	if (!m) return null;
	const h = Number(m[1]);
	const min = Number(m[2]);
	if (h > 23 || min > 59) return null;
	return h * 60 + min;
}

/**
 * Sábado ou domingo, por aritmética de calendário pura.
 *
 * `Date.UTC` + `getUTCDay` pela mesma razão de `$lib/planos/horas-extras`: não
 * há string local sendo parseada, então o resultado não depende de offset nem de
 * como a engine resolve uma hora local inexistente.
 */
function ehFimDeSemana(iso: string): boolean {
	if (!ISO.test(iso)) return false;
	const [ano, mes, dia] = iso.split('-').map(Number);
	const d = new Date(Date.UTC(ano, mes - 1, dia)).getUTCDay();
	return d === 0 || d === 6;
}

/**
 * Qual caminho do decreto a missão de um dia percorre.
 *
 * Ver o cabeçalho para a ordem, que não é comutativa.
 */
export function extrapolaJornada(janela: JanelaDaMissao): Extrapolacao {
	const { data, feriado = false, minutosIda } = janela;

	// 1. Presunção do art. 22 — vale antes de qualquer horário.
	if (ehFimDeSemana(data) || feriado) return 'dia_pago';

	// 2. Horário declarado. Os DOIS precisam estar preenchidos: um requerimento
	//    com só a saída não declarou a jornada, declarou metade dela.
	const inicio = minutosDoDia(janela.horaInicio);
	const fim = minutosDoDia(janela.horaFim);
	if (inicio !== null && fim !== null) {
		// "Após as 18h" é estrito: retorno às 18:00 em ponto é o fim do
		// expediente ordinário, não uma extrapolação dele.
		const madrugada = inicio < HORA_SAIDA_MADRUGADA * 60;
		const noturno = fim > HORA_RETORNO_NOTURNO * 60;
		return madrugada || noturno ? 'horario_declarado' : 'nao';
	}

	// 3. Sem horário declarado: o cálculo estimado, se houver tempo de viagem.
	if (typeof minutosIda !== 'number' || !Number.isFinite(minutosIda) || minutosIda < 0) {
		return 'indeterminada';
	}
	const total = (2 * minutosIda) / 60 + PERMANENCIA_PRESUMIDA_HORAS;
	return total > JORNADA_ORDINARIA_HORAS ? 'estimada' : 'nao';
}

/** `true` quando o caminho percorrido reconhece a extrapolação. */
export function houveExtrapolacao(e: Extrapolacao): boolean {
	return e === 'dia_pago' || e === 'horario_declarado' || e === 'estimada';
}
