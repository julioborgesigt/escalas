/**
 * Qual RUBRICA a equipe recebe: diária, hora extra ou nada.
 *
 * ## A distância decide primeiro
 *
 * A regra da corporação é de DESLOCAMENTO, não de relógio: percorrer 100 km ou
 * mais entre a cidade de origem da equipe e a cidade de destino é pago em
 * diária. Só abaixo desse limite a pergunta passa a ser "que horas eram?".
 *
 * A ordem importa e não é comutativa. Uma equipe que sai de Jucás para Acopiara
 * numa terça às 09:00 percorre mais de 100 km dentro do expediente ordinário:
 * pelo relógio ela custaria ZERO, e pela distância ela custa diária. Consultar
 * o horário primeiro produziria "sem custo" para uma equipe que dormiu fora.
 *
 * ## Distância ausente não é distância zero
 *
 * `null` é "ninguém mediu ainda" — o estado das equipes anteriores a esta regra
 * e o de toda equipe recém-criada. Zero é uma medida: afirma que origem e
 * destino são a mesma cidade. Tratar as duas igual faria a tela sugerir hora
 * extra como se a distância tivesse sido conferida e dado abaixo do limite, que
 * é exatamente o erro caro — a diária não sugerida é a que não é paga.
 *
 * Por isso a sugestão devolve o `motivo`: quem chama precisa poder dizer na
 * tela POR QUE aquela rubrica foi proposta, e avisar quando a proposta saiu sem
 * o dado que manda nela.
 *
 * ## O que esta função NÃO decide
 *
 * **Quantas** diárias, e se a diária é estadual ou interestadual. A quantidade
 * é do Admin Geral (é ele quem sabe se a equipe dorme fora uma ou três noites),
 * e "interestadual" é atravessar divisa de estado — 500 km dentro do Ceará
 * continuam sendo diária estadual, e nenhum número de quilômetros distingue os
 * dois casos.
 */
import type { HorasClassificadas } from './horas-extras';

/**
 * A partir de quantos quilômetros o deslocamento é pago em diária.
 *
 * Constante nomeada, e não `100` espalhado: a comparação aparece na regra, na
 * mensagem da tela e nos testes, e um limite que muda por decisão da corporação
 * não pode depender de encontrar as três.
 */
export const DISTANCIA_MINIMA_DIARIA_KM = 100;

/**
 * Por que a rubrica sugerida é essa.
 *
 * Não exportado: quem consome compara com o literal (`motivo === 'distancia'`),
 * e o tipo já viaja dentro de `SugestaoCusteio`.
 */
type MotivoCusteio =
	/** O deslocamento alcançou `DISTANCIA_MINIMA_DIARIA_KM`. */
	| 'distancia'
	/** Abaixo do limite: valeu a classificação da janela. */
	| 'horario'
	/** Sem distância informada — a janela decidiu, mas a medida falta. */
	| 'sem_distancia';

/** A rubrica proposta e o que a justificou. */
export interface SugestaoCusteio {
	tipo_custo: 'sem_custo' | 'hora_extra' | 'diaria';
	motivo: MotivoCusteio;
	/** Horas a copiar para os campos — zeradas quando a rubrica é diária. */
	horas: HorasClassificadas;
}

/**
 * A rubrica que a equipe deveria receber.
 *
 * `distanciaKm` é `null` quando ninguém mediu. Nesse caso a janela decide, mas
 * o motivo sai como `sem_distancia` para a tela poder dizer que a sugestão foi
 * dada sem o dado que manda nela.
 */
export function sugerirCusteio(entrada: {
	distanciaKm: number | null;
	horas: HorasClassificadas;
}): SugestaoCusteio {
	const { distanciaKm, horas } = entrada;

	// Negativo e `NaN` são entrada quebrada, não medida: caem no mesmo caminho de
	// "ninguém mediu" em vez de virarem uma comparação numérica sem sentido.
	const medida =
		typeof distanciaKm === 'number' && Number.isFinite(distanciaKm) && distanciaKm >= 0
			? distanciaKm
			: null;

	if (medida !== null && medida >= DISTANCIA_MINIMA_DIARIA_KM) {
		// A diária SUBSTITUI a hora extra — não se somam. Zerar as horas aqui é o
		// que impede o card de guardar 9h de hora extra "esquecidas" ao lado da
		// diária, que o Anexo II somaria se a rubrica voltasse a mudar.
		return {
			tipo_custo: 'diaria',
			motivo: 'distancia',
			horas: { normais: 0, plus: 0, semCusto: 0 }
		};
	}

	// Janela inteiramente dentro do expediente não gera hora nenhuma — a sugestão
	// certa ali é "sem custo", e não "hora extra de zero horas".
	const tipo_custo = horas.normais + horas.plus === 0 ? 'sem_custo' : 'hora_extra';
	return { tipo_custo, motivo: medida === null ? 'sem_distancia' : 'horario', horas };
}
