/**
 * O PARECER: esta missão gera diária, quantas, e com que fundamento.
 *
 * Junta as três regras do domínio — contagem, jornada e vedações — na ordem que
 * o Decreto nº 35.922/2024 estabelece, e devolve um objeto que a tela e o
 * documento conseguem IMPRIMIR.
 *
 * ## Por que os fundamentos viajam com o resultado
 *
 * O parecer entra num processo administrativo. "Desfavorável" sozinho não se
 * defende, não se contesta e não se audita; "desfavorável — a missão de um dia
 * não extrapolou a jornada ordinária (Decreto nº 35.922/2024)" se defende. Por
 * isso cada passo da análise emite o seu `Fundamento`, com o dispositivo ao
 * lado, em vez de a tela remontar a justificativa a partir do resultado — que é
 * como as duas versam diferente sobre o mesmo caso.
 *
 * O campo `dispositivo` traz só o que o texto normativo da corporação atribui
 * expressamente: `art. 22` para a presunção de fim de semana e feriado,
 * `art. 4º, §1º, II` para a vedação de região metropolitana, `art. 13` para o
 * teto mensal. Onde a atribuição não foi dada, o dispositivo é o decreto inteiro
 * — inventar um número de artigo num documento que circula assinado é pior do
 * que não citar nenhum.
 *
 * ## O que este módulo NÃO decide
 *
 * Se a rubrica paga é diária ou hora extra. O parecer diz se a diária é DEVIDA;
 * a escolha entre as duas verbas é do DPI SUL e mora em `$lib/planos/custeio`,
 * que consome isto. E `analisarDiaria` não fala com o banco: o que depende de
 * consulta (região metropolitana, quanto o servidor já lançou no mês) entra
 * pronto na entrada, para a regra continuar pura e testável.
 */
import { diasDoAfastamento, totalDeMeias } from './contagem';
import { extrapolaJornada, houveExtrapolacao } from './jornada';
import type { Extrapolacao } from './jornada';
import { alertasDaViagem } from './vedacoes';
import type { Alerta, RegiaoMetropolitana } from './vedacoes';

/**
 * Uma razão do parecer, com o dispositivo que a sustenta.
 *
 * Não exportada: ela viaja dentro de `Parecer.fundamentos`, e a tela lê os
 * campos por inferência. Um tipo exportado que ninguém importa é superfície a
 * manter sem uso.
 */
interface Fundamento {
	texto: string;
	/** `'art. 22'`, `'art. 4º, §1º, II'` — ou o decreto, quando não há atribuição. */
	dispositivo: string;
}

/** O parecer sobre uma missão. */
export interface Parecer {
	resultado: 'favoravel' | 'desfavoravel';
	/** Meias diárias devidas. Zero quando desfavorável. */
	meias: number;
	/** O caminho do decreto percorrido — a tela usa para explicar. */
	extrapolacao: Extrapolacao;
	/** O que precisa de conferência humana; não impede o deferimento. */
	alertas: Alerta[];
	fundamentos: Fundamento[];
}

/** Tudo o que a análise precisa, já resolvido — nada aqui consulta o banco. */
export interface EntradaParecer {
	dataInicio: string;
	dataFim: string;
	feriado?: boolean;
	horaInicio?: string | null;
	horaFim?: string | null;
	/** Tempo de IDA em minutos, só usado no cálculo estimado. */
	minutosIda?: number | null;
	regiaoOrigem?: RegiaoMetropolitana | null;
	regiaoDestino?: RegiaoMetropolitana | null;
	mesmaCidade?: boolean;
	distanciaKm?: number | null;
	/** Meses que estourariam o teto do art. 13 (ver `mesesAcimaDoTeto`). */
	mesesAcimaDoTeto?: string[];
}

const DECRETO = 'Decreto nº 35.922/2024';

/** O texto que explica cada caminho da jornada, para o dia único. */
const EXPLICACAO: Record<Extrapolacao, Fundamento> = {
	dia_pago: {
		texto: 'Missão em fim de semana ou feriado — extrapolação presumida da jornada.',
		dispositivo: 'art. 22'
	},
	horario_declarado: {
		texto:
			'Horário declarado com saída de madrugada (antes das 6h) ou retorno noturno (após as 18h).',
		dispositivo: DECRETO
	},
	estimada: {
		texto:
			'Sem horário declarado: o percurso estimado (2 × ida + 3h de permanência) passa de 8 horas.',
		dispositivo: DECRETO
	},
	nao: {
		texto: 'A missão de um dia não extrapolou a jornada ordinária de 8 horas.',
		dispositivo: DECRETO
	},
	indeterminada: {
		texto:
			'Sem horário declarado e sem tempo de viagem medido: não há como aferir a extrapolação da jornada.',
		dispositivo: DECRETO
	}
};

/**
 * O parecer sobre a missão descrita em `entrada`.
 *
 * A ordem não é comutativa: o período é conferido primeiro (sem `N` não há o que
 * analisar); depois o pernoite, que dispensa o teste de jornada; e só na missão
 * de um dia a extrapolação decide.
 */
export function analisarDiaria(entrada: EntradaParecer): Parecer {
	const { dataInicio, dataFim } = entrada;
	const dias = diasDoAfastamento(dataInicio, dataFim);

	if (dias === null) {
		return {
			resultado: 'desfavoravel',
			meias: 0,
			extrapolacao: 'indeterminada',
			alertas: [],
			fundamentos: [
				{
					texto: 'Período de afastamento ausente, invertido ou longo demais para ser analisado.',
					dispositivo: DECRETO
				}
			]
		};
	}

	// A jornada só é consultada na missão de um dia, mas o resultado dela entra
	// nas vedações mesmo com pernoite: a do art. 4º, §1º, II exige AUSÊNCIA de
	// extrapolação, e uma missão com pernoite que também extrapola não pode ser
	// alertada como se não extrapolasse.
	const extrapolacao = extrapolaJornada({
		data: dataInicio,
		feriado: entrada.feriado,
		horaInicio: entrada.horaInicio,
		horaFim: entrada.horaFim,
		minutosIda: entrada.minutosIda
	});

	const alertas = alertasDaViagem({
		regiaoOrigem: entrada.regiaoOrigem,
		regiaoDestino: entrada.regiaoDestino,
		mesmaCidade: entrada.mesmaCidade,
		distanciaKm: entrada.distanciaKm,
		extrapolacao,
		mesesAcimaDoTeto: entrada.mesesAcimaDoTeto
	});

	const fundamentos: Fundamento[] = [];

	if (dias > 1) {
		const meias = totalDeMeias(dataInicio, dataFim);
		fundamentos.push({
			texto: `Afastamento de ${dias} dias com pernoite: ${dias} − 0,5 diárias.`,
			dispositivo: DECRETO
		});
		acrescentarAlertas(fundamentos, alertas);
		return { resultado: 'favoravel', meias, extrapolacao, alertas, fundamentos };
	}

	fundamentos.push(EXPLICACAO[extrapolacao]);
	acrescentarAlertas(fundamentos, alertas);

	if (!houveExtrapolacao(extrapolacao)) {
		return { resultado: 'desfavoravel', meias: 0, extrapolacao, alertas, fundamentos };
	}
	return {
		resultado: 'favoravel',
		meias: totalDeMeias(dataInicio, dataFim),
		extrapolacao,
		alertas,
		fundamentos
	};
}

/** Cada alerta também vira fundamento — é assim que ele sai impresso. */
function acrescentarAlertas(fundamentos: Fundamento[], alertas: Alerta[]): void {
	for (const a of alertas) {
		if (a === 'mesma_regiao_metropolitana') {
			fundamentos.push({
				texto:
					'Deslocamento dentro da mesma região metropolitana, em até 120 km e sem extrapolação de jornada — confira a vedação antes de conceder.',
				dispositivo: 'art. 4º, §1º, II'
			});
		} else if (a === 'sem_afastamento_da_sede') {
			fundamentos.push({
				texto: 'Origem e destino no mesmo município: confira se houve afastamento da sede.',
				dispositivo: DECRETO
			});
		} else {
			fundamentos.push({
				texto: 'O servidor passaria de 15 diárias em algum mês alcançado por esta missão.',
				dispositivo: 'art. 13'
			});
		}
	}
}
