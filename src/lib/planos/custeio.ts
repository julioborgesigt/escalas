/**
 * Qual RUBRICA a equipe recebe: diária, hora extra ou nada.
 *
 * ## A ordem é: primeiro a diária, e só na recusa o relógio
 *
 * É a ordem da corporação — o plano verifica as regras da diária e, não sendo
 * possível concedê-la, define hora extra. **As duas nunca se somam**, e isso é
 * decisão do DPI SUL, não do decreto: o Decreto nº 36.182/2024 PERMITE que a
 * diária seja percebida concomitantemente com o reforço operacional fora da
 * escala regular. Precisa estar escrito, senão quem ler o decreto depois vai
 * "corrigir" a inconsistência somando as duas.
 *
 * Quem decide se a diária é DEVIDA é `$lib/diarias/parecer`, que aplica o
 * Decreto nº 35.922/2024. O que sobra para este módulo é a camada da casa: qual
 * das duas verbas pagar por uma missão que se qualifica para as duas.
 *
 * ## O que a camada da casa acrescenta: distância e duração
 *
 * Não é o decreto que fixa 100 km — o decreto fala em 8 horas de jornada e em
 * 120 km, este último só dentro de região metropolitana e só combinado com
 * AUSÊNCIA de extrapolação. Os 100 km são a aritmética do próprio decreto com a
 * permanência REAL no lugar da presumida:
 *
 * - o cálculo estimado do decreto é `2 × ida + 3h de permanência > 8h`;
 * - a operação do DPI SUL dura 4h (04h–08h), não 3h;
 * - com o número real, o teste vira `ida > 2h` — que nas estradas do Ceará cai
 *   perto de 100 km (mediana medida: 123 km).
 *
 * Medido em 4.005 pares do Ceará, `km ≥ 100` e `2×ida + 4h > 8h` concordam em
 * **96,5%**; onde discordam, é a convenção dos 100 km que concede. Daí o portão
 * de duração: numa operação de 2h, 100 km dariam `2×2 + 2 = 6h`, e a diária
 * deixaria de se justificar.
 *
 * ## Três "nãos" diferentes, e por que não podem virar um só
 *
 * `sem_distancia` (ninguém mediu), `duracao_curta` (operação de menos de 4h) e
 * `sem_janela` (operação sem `hora_fim`, que o plano permite de propósito) levam
 * todos à hora extra — mas por razões que a tela precisa dizer separadas.
 * Colapsá-los faria a tela afirmar "operação curta demais" sobre uma janela que
 * ninguém fechou, que é exatamente o erro que `sem_distancia` já existe para não
 * cometer: a diária não sugerida é a que não é paga.
 *
 * ## O que esta função NÃO decide
 *
 * Se a diária é estadual ou interestadual. Atravessar divisa de estado é outra
 * pergunta, e 500 km dentro do Ceará continuam sendo diária estadual — nenhum
 * número de quilômetros distingue os dois casos.
 */
import type { HorasClassificadas } from './horas-extras';
import { duracaoDaJanela } from './horas-extras';
import type { Parecer } from '$lib/diarias/parecer';

/**
 * O padrão de quilômetros a partir do qual o deslocamento é pago em diária.
 *
 * **É só o padrão.** O limite em vigor é campo do Super Admin, gravado em
 * `custo_parametros.distancia_minima_diaria_km` e congelado junto com os valores
 * do plano — este número serve para semear uma versão nova e para o plano que
 * ainda não tem tabela de valores. Ver a migração `0073` e o cabeçalho acima
 * para de onde vêm os 100.
 */
export const DISTANCIA_MINIMA_DIARIA_KM = 100;

/**
 * Quantas horas a operação precisa durar para os quilômetros valerem diária.
 *
 * Quatro, porque é a permanência real que faz `2×ida + permanência` alcançar as
 * 8 horas da jornada ordinária no limite de distância — ver o cabeçalho. Não é
 * campo de tela: o limite de km foi o que a corporação pediu para manejar, e um
 * segundo parâmetro sem pedido seria superfície a manter sem uso.
 */
export const DURACAO_MINIMA_DIARIA_HORAS = 4;

/**
 * O piso de meias diárias da equipe de plano operacional: 1,5 diária.
 *
 * Cota mínima definida pela corporação. O decreto chegaria a 0,5 numa missão de
 * um dia (`2N − 1` com `N = 1`); a casa paga 1,5, que é o que a missão de fato
 * custa quando a equipe sai na véspera. O piso é `max`, não substituição —
 * missão mais longa recebe o que a contagem der.
 */
export const MEIAS_MINIMAS_PLANO = 3;

/**
 * Por que a rubrica sugerida é essa.
 *
 * Não exportado: quem consome compara com o literal (`motivo === 'distancia'`),
 * e o tipo já viaja dentro de `SugestaoCusteio`.
 */
type MotivoCusteio =
	/** O deslocamento alcançou o limite e a diária é devida. */
	| 'distancia'
	/** Abaixo do limite: valeu a classificação da janela. */
	| 'horario'
	/** Sem distância informada — a janela decidiu, mas a medida falta. */
	| 'sem_distancia'
	/** Distância suficiente, operação de menos de 4h. */
	| 'duracao_curta'
	/** Distância suficiente, mas a operação não tem janela fechada para aferir. */
	| 'sem_janela'
	/** Distância e duração suficientes, mas o parecer recusou a diária. */
	| 'parecer';

/** A rubrica proposta e o que a justificou. */
export interface SugestaoCusteio {
	tipo_custo: 'sem_custo' | 'hora_extra' | 'diaria';
	motivo: MotivoCusteio;
	/** Horas a copiar para os campos — zeradas quando a rubrica é diária. */
	horas: HorasClassificadas;
	/** Meias diárias sugeridas; zero quando a rubrica não é diária. */
	meias: number;
}

/**
 * A rubrica que a equipe deveria receber.
 *
 * `distanciaKm` é `null` quando ninguém mediu; `limiteKm` vem da versão de
 * valores que o plano aplica; `parecer` é o de `$lib/diarias`. Sem parecer, a
 * diária não é sugerida — é o mesmo princípio de `sem_distancia`, um passo
 * acima: não se concede o que não foi analisado.
 */
export function sugerirCusteio(entrada: {
	distanciaKm: number | null;
	horas: HorasClassificadas;
	limiteKm?: number;
	parecer?: Parecer | null;
}): SugestaoCusteio {
	const { distanciaKm, horas, parecer } = entrada;
	const limiteKm = entrada.limiteKm ?? DISTANCIA_MINIMA_DIARIA_KM;

	// A diária SUBSTITUI a hora extra — não se somam (ver o cabeçalho). Zerar as
	// horas aqui é o que impede o card de guardar 9h "esquecidas" ao lado da
	// diária, que o Anexo II somaria se a rubrica voltasse a mudar.
	const comoDiaria = (meias: number): SugestaoCusteio => ({
		tipo_custo: 'diaria',
		motivo: 'distancia',
		horas: { normais: 0, plus: 0, semCusto: 0 },
		meias
	});

	// Janela inteiramente dentro do expediente não gera hora nenhuma — a sugestão
	// certa ali é "sem custo", e não "hora extra de zero horas".
	const comoRelogio = (motivo: MotivoCusteio): SugestaoCusteio => ({
		tipo_custo: horas.normais + horas.plus === 0 ? 'sem_custo' : 'hora_extra',
		motivo,
		horas,
		meias: 0
	});

	// Negativo e `NaN` são entrada quebrada, não medida: caem no mesmo caminho de
	// "ninguém mediu" em vez de virarem uma comparação numérica sem sentido.
	const medida =
		typeof distanciaKm === 'number' && Number.isFinite(distanciaKm) && distanciaKm >= 0
			? distanciaKm
			: null;

	if (medida === null) return comoRelogio('sem_distancia');
	if (medida < limiteKm) return comoRelogio('horario');

	// Daqui para baixo a distância bastaria. Falta a duração e o parecer.
	const duracao = duracaoDaJanela(horas);
	if (duracao === 0) return comoRelogio('sem_janela');
	if (duracao < DURACAO_MINIMA_DIARIA_HORAS) return comoRelogio('duracao_curta');
	if (!parecer || parecer.resultado !== 'favoravel') return comoRelogio('parecer');

	return comoDiaria(Math.max(parecer.meias, MEIAS_MINIMAS_PLANO));
}
