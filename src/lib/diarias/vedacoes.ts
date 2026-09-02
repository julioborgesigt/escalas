/**
 * As vedações do Decreto nº 35.922/2024 — que aqui ALERTAM, não bloqueiam.
 *
 * ## Por que alertar
 *
 * Decisão da corporação, e ela tem fundamento no próprio texto: a vedação do
 * art. 4º, §1º, II exige TRÊS condições simultâneas — mesma região
 * metropolitana, até 120 km, **e** sem extrapolação de jornada. A terceira é de
 * relógio, não de geografia, e na operação das 04h ela nunca se verifica. Barrar
 * pela geografia sozinha recusaria o que a lei permite.
 *
 * Então o alerta dispara quando as condições REALMENTE fecham, e a pessoa
 * decide. É raro por construção — e é isso que o mantém legível: alerta que
 * aparece em todo plano vira decoração, e ninguém lê decoração.
 *
 * ## O que este módulo NÃO cobre
 *
 * A vedação de concomitância com auxílio-alimentação do mesmo dia. O sistema não
 * guarda auxílio-alimentação, e inventar um campo "declaro que não recebi" que
 * ninguém confere seria teatro. Fica com o Termo de Declaração, que é assinado
 * pela autoridade e é onde essa afirmação tem consequência.
 */
import type { Extrapolacao } from './jornada';
import { houveExtrapolacao } from './jornada';

/** As regiões metropolitanas do Ceará (ver `municipios.regiao_metropolitana`). */
export type RegiaoMetropolitana = 'RMF' | 'RMC' | 'RMS';

/** Até quantos km a vedação de região metropolitana pode alcançar. */
export const DISTANCIA_MAXIMA_VEDACAO_RM_KM = 120;

/** O que precisa ser conferido por gente antes de conceder. */
export type Alerta =
	/** Art. 4º, §1º, II: mesma região metropolitana, ≤ 120 km e sem extrapolação. */
	| 'mesma_regiao_metropolitana'
	/** Origem e destino no mesmo município: não houve afastamento da sede. */
	| 'sem_afastamento_da_sede'
	/** Art. 13: algum mês passaria de 15 diárias para o servidor. */
	| 'teto_mensal';

/** A viagem, do ponto de vista das vedações. */
export interface ViagemParaVedacao {
	/** Região metropolitana da origem — `null` fora de todas (138 dos 184). */
	regiaoOrigem?: RegiaoMetropolitana | null;
	regiaoDestino?: RegiaoMetropolitana | null;
	/** Origem e destino são o MESMO município. */
	mesmaCidade?: boolean;
	/** Quilômetros do trajeto; `null` quando ninguém mediu. */
	distanciaKm?: number | null;
	/** O que `extrapolaJornada` respondeu para esta missão. */
	extrapolacao: Extrapolacao;
	/** Meses que estourariam o teto (ver `mesesAcimaDoTeto`). */
	mesesAcimaDoTeto?: string[];
}

/**
 * Os alertas aplicáveis, em ordem estável.
 *
 * Vazio é o caso normal. Cada alerta que sai daqui é uma pergunta para uma
 * pessoa, não uma recusa.
 */
export function alertasDaViagem(viagem: ViagemParaVedacao): Alerta[] {
	const alertas: Alerta[] = [];
	const { regiaoOrigem, regiaoDestino, distanciaKm, extrapolacao } = viagem;

	// As três condições do art. 4º, §1º, II, juntas. `distanciaKm` ausente NÃO
	// dispara: sem medida não se sabe se está dentro dos 120 km, e alertar por
	// desconhecimento é o começo do alerta que ninguém lê.
	const mesmaRegiao = Boolean(regiaoOrigem) && regiaoOrigem === regiaoDestino;
	const dentroDoRaio =
		typeof distanciaKm === 'number' &&
		Number.isFinite(distanciaKm) &&
		distanciaKm <= DISTANCIA_MAXIMA_VEDACAO_RM_KM;
	if (mesmaRegiao && dentroDoRaio && !houveExtrapolacao(extrapolacao)) {
		alertas.push('mesma_regiao_metropolitana');
	}

	if (viagem.mesmaCidade) alertas.push('sem_afastamento_da_sede');
	if ((viagem.mesesAcimaDoTeto?.length ?? 0) > 0) alertas.push('teto_mensal');

	return alertas;
}
