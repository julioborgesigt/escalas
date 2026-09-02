/**
 * Classificação das horas de uma operação em NORMAL, PLUS e SEM CUSTO.
 *
 * A regra da corporação, por hora cheia:
 *
 * | quando                       | 00:00–05:59 | 06:00–07:59 | 08:00–17:59 | 18:00–23:59 |
 * | ---------------------------- | ----------- | ----------- | ----------- | ----------- |
 * | dia útil                     | plus        | normal      | SEM CUSTO   | normal      |
 * | sábado, domingo ou feriado   | plus        | plus        | plus        | plus        |
 *
 * A faixa 08:00–17:59 em dia útil é o expediente ordinário: o servidor já é pago
 * por ela, e a operação não gera custo adicional. Fim de semana e feriado não
 * têm expediente ordinário nenhum — daí a linha inteira ser paga, e com o
 * acréscimo de 30% que define a hora "plus".
 *
 * ## A hora extra é SUBORDINADA à diária, e o dispositivo dela está pendente
 *
 * A corporação define hora extra como trabalho fora do expediente de 08h às 18h
 * **quando não couber diária** — a subordinação é aplicada em `sugerirCusteio`,
 * que consulta o parecer de `$lib/diarias` antes de olhar o relógio.
 *
 * A tabela acima é regra da corporação e **o dispositivo legal ainda não foi
 * fornecido**. Está escrito porque a alternativa é pior: o Decreto nº
 * 35.922/2024, que este projeto agora cita em `$lib/diarias`, trata só da
 * diária, e quem chegar aqui depois de lê-lo vai procurar nesta tabela um artigo
 * que não existe. É a mesma doutrina que o `CLAUDE.md` aplica a sigla de achado
 * órfã: declarar a ausência é o que a separa de um esquecimento.
 *
 * O limite de 06:00 desta tabela **não é o mesmo** do teste de extrapolação do
 * decreto, e confundi-los custaria dinheiro: aqui 06:00–07:59 é hora extra
 * normal; lá, saída às 06:30 não extrapola a jornada. Dois testes, duas verbas.
 *
 * ## Isto é SUGESTÃO, não cálculo final
 *
 * A quantidade que vai ao documento é digitada pelo Admin Geral. Esta função
 * existe para preencher o campo com um ponto de partida defensável — há equipe
 * que desloca antes do horário do plano, equipe que volta depois, e a janela
 * real de cada uma só quem monta a operação sabe. Tratar a saída daqui como
 * verdade faria o sistema orçar uma jornada que ninguém cumpriu.
 *
 * ## Fuso: onde está o risco de verdade, e onde NÃO está
 *
 * O `CLAUDE.md` cataloga três bugs de fuso no projeto (`hoje()` com
 * `toISOString()`, o laço "dias do intervalo", `toISO` com duas convenções de
 * mês). Todos vieram da mesma forma: horário LOCAL na entrada, UTC na saída.
 * Errar o dia da semana aqui seria silencioso e caro — classificar um sábado
 * como sexta troca dez horas "plus" por "sem custo" e o total do PDF cai sem
 * nada denunciar.
 *
 * Mas convém registrar o que foi MEDIDO, porque a intuição erra para o lado
 * alarmista e comentário errado é pior que comentário nenhum:
 *
 * - `new Date(iso + 'T00:00:00').getDay()` **não** tem esse defeito. Local na
 *   entrada e local na saída se cancelam: sob `TZ=Pacific/Kiritimati` (UTC+14)
 *   e `TZ=Pacific/Midway` (UTC-11) o dia da semana sai certo. Até na virada do
 *   horário de verão brasileiro (2018-11-04, quando a meia-noite não existiu em
 *   São Paulo) o V8 resolve para 01:00 do MESMO dia e `getDay()` acerta;
 * - o que quebra é misturar as convenções — `T00:00:00` local somado a
 *   `toISOString()`. Isso não acontece em lugar nenhum deste arquivo.
 *
 * Ainda assim o dia da semana sai de `Date.UTC(...)` + `getUTCDay()`, e o
 * passeio pelos dias de `adicionarDias` (`$lib/utils/datas`, conta inteira em
 * UTC). O motivo não é corrigir um bug demonstrado: é não deixar o resultado
 * DEPENDER de como a engine resolve um horário local inexistente. Aritmética de
 * calendário pura não tem esse grau de liberdade, e o custo de usá-la é zero.
 *
 * Nota para quem for testar: **não adianta mexer em `process.env.TZ`** — o Node
 * cacheia o fuso no start do processo e a mudança em runtime não alcança o
 * `Date` (medido). Um teste assim fica verde com a implementação quebrada. Ver
 * o bloco "blindagem de calendário" em `__tests__/horas-extras.test.ts`.
 */
import { adicionarDias } from '$lib/utils/datas';

/** Quantas horas de cada espécie a janela produz. */
export interface HorasClassificadas {
	/** Hora extra comum. */
	normais: number;
	/** Hora extra acrescida de 30% (madrugada, fim de semana, feriado). */
	plus: number;
	/** Expediente ordinário — não gera custo. */
	semCusto: number;
}

/** A janela a classificar. Datas em `YYYY-MM-DD`, horas em `HH:MM`. */
export interface JanelaOperacao {
	dataInicio: string;
	horaInicio: string;
	/** Ausente = mesmo dia do início. */
	dataFim?: string | null;
	horaFim?: string | null;
	/**
	 * O dia de início é feriado.
	 *
	 * Vale para `dataInicio` apenas. Uma janela que atravessa a meia-noite cai,
	 * a partir daí, na classificação normal do dia seguinte: feriado que emenda
	 * com outro é caso raro o bastante para o Admin Geral ajustar a quantidade à
	 * mão, e inventar um segundo campo de feriado para cobri-lo custaria mais
	 * confusão do que resolve.
	 */
	feriado?: boolean;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const HORA = /^(\d{1,2}):(\d{2})$/;

/** Minutos desde a meia-noite, ou `null` se a hora não for `HH:MM` válida. */
function minutosDoDia(hora: string | null | undefined): number | null {
	const m = HORA.exec((hora ?? '').trim());
	if (!m) return null;
	const h = Number(m[1]);
	const min = Number(m[2]);
	if (h > 23 || min > 59) return null;
	return h * 60 + min;
}

/**
 * O dia da semana (0 = domingo) de uma data ISO — aritmética de calendário
 * pura, sem fuso e sem horário de verão no caminho.
 *
 * `Date.UTC` recebe os componentes já separados e `getUTCDay` os lê na mesma
 * convenção: não há string local sendo parseada, então o resultado não depende
 * de offset nem de como a engine resolve uma hora local inexistente. O parse
 * local também acertaria (ver o cabeçalho — foi medido); isto apenas tira a
 * pergunta de cima da mesa.
 */
function diaDaSemana(iso: string): number {
	const [ano, mes, dia] = iso.split('-').map(Number);
	return new Date(Date.UTC(ano, mes - 1, dia)).getUTCDay();
}

/** Sábado ou domingo. */
function ehFimDeSemana(iso: string): boolean {
	const d = diaDaSemana(iso);
	return d === 0 || d === 6;
}

/**
 * A espécie de UMA hora cheia que começa em `horaCheia` (0–23) no dia `iso`.
 *
 * `diaPago` liga o regime de fim de semana/feriado: tudo vira plus.
 */
function especieDaHora(horaCheia: number, diaPago: boolean): keyof HorasClassificadas {
	if (diaPago) return 'plus';
	if (horaCheia < 6) return 'plus';
	if (horaCheia < 8) return 'normais';
	if (horaCheia < 18) return 'semCusto';
	return 'normais';
}

/**
 * Teto de segurança do laço: 31 dias. Uma operação não dura um mês, e sem o
 * teto uma `dataFim` digitada como `2226-09-29` prenderia o Worker.
 */
const MAX_DIAS = 31;

/**
 * Classifica a janela hora a hora.
 *
 * Conta por HORA CHEIA INICIADA, que é como a corporação paga: entrar às 05:30 e
 * sair às 06:10 são duas horas (a das 05, plus; a das 06, normal), não 40
 * minutos rateados. É também o que torna o resultado inteiro — não há meia hora
 * extra no documento.
 *
 * Devolve tudo zerado quando a janela é inválida (formato errado, fim antes do
 * início, ausência de fim). Zerado é o estado que a tela mostra como "sem
 * sugestão", e é melhor do que um palpite: ver o cabeçalho.
 */
export function classificarJanela(janela: JanelaOperacao): HorasClassificadas {
	const vazio: HorasClassificadas = { normais: 0, plus: 0, semCusto: 0 };

	const { dataInicio, horaInicio, feriado = false } = janela;
	const dataFim = janela.dataFim || dataInicio;
	const horaFim = janela.horaFim;

	if (!ISO.test(dataInicio) || !ISO.test(dataFim)) return vazio;

	const inicioMin = minutosDoDia(horaInicio);
	const fimMin = minutosDoDia(horaFim);
	if (inicioMin === null || fimMin === null) return vazio;

	if (dataFim < dataInicio) return vazio;
	if (dataFim === dataInicio && fimMin <= inicioMin) return vazio;

	const out: HorasClassificadas = { normais: 0, plus: 0, semCusto: 0 };

	let dia = dataInicio;
	let dias = 0;
	while (dia <= dataFim && dias < MAX_DIAS) {
		// O feriado marcado vale só para o dia de início; os demais seguem o
		// calendário (ver o JSDoc de `JanelaOperacao.feriado`).
		const diaPago = ehFimDeSemana(dia) || (dia === dataInicio && feriado);

		// Primeira e última hora cheia a contar NESTE dia.
		const primeira = dia === dataInicio ? Math.floor(inicioMin / 60) : 0;
		// A hora do minuto final não conta quando ele cai exatamente na virada:
		// sair às 18:00 é 17 a última hora iniciada.
		const ultima = dia === dataFim ? Math.ceil(fimMin / 60) - 1 : 23;

		for (let h = primeira; h <= ultima; h++) {
			out[especieDaHora(h, diaPago)] += 1;
		}

		dia = adicionarDias(dia, 1);
		dias++;
	}

	return out;
}

/**
 * Total de horas que geram custo (normais + plus) — o que a equipe recebe.
 *
 * `semCusto` fica de fora de propósito: ele descreve a jornada, não a despesa.
 */
export function horasPagas(h: HorasClassificadas): number {
	return h.normais + h.plus;
}

/**
 * O TAMANHO da janela em horas cheias — os três baldes somados.
 *
 * É uma medida exata, e não uma estimativa: `classificarJanela` põe cada hora
 * cheia iniciada em exatamente um balde, então a soma é a duração. Existe para
 * quem precisa da jornada inteira, e não da despesa — hoje `sugerirCusteio`, que
 * só admite diária em operação de 4h ou mais.
 *
 * Zero tem dois significados que quem chama precisa distinguir: janela vazia
 * (sem `hora_fim`, que o plano permite) e janela inválida. Nos dois casos não há
 * duração aferida, que é diferente de duração curta.
 */
export function duracaoDaJanela(h: HorasClassificadas): number {
	return h.normais + h.plus + h.semCusto;
}
