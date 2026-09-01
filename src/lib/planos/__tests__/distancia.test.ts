import { describe, it, expect } from 'vitest';
import { distanciaDoTrajeto, chaveDoPar } from '../distancia';

/** Códigos IBGE reais, para o teste falar a mesma língua do banco. */
const JUCAS = '2307403';
const IGUATU = '2305506';
const ACOPIARA = '2300309';
const FORA_DA_MATRIZ = '2999999';

/** Distâncias reais da matriz gerada (conferidas contra o valor de estrada). */
const MATRIZ = new Map<string, number>([
	[chaveDoPar(JUCAS, IGUATU), 35],
	[chaveDoPar(IGUATU, ACOPIARA), 37],
	[chaveDoPar(JUCAS, ACOPIARA), 70]
]);

describe('distanciaDoTrajeto', () => {
	it('soma as duas pernas quando o briefing tem município', () => {
		// Jucás → Iguatu → Acopiara: 35 + 37, e não os 70 do caminho direto.
		expect(
			distanciaDoTrajeto({ origem: JUCAS, briefing: IGUATU, destino: ACOPIARA }, MATRIZ)
		).toEqual({ km: 72, via: 'briefing' });
	});

	it('mede as pontas quando o briefing não tem município, e MARCA como direto', () => {
		// A marca é o que permite a tela dizer que a parada não entrou na conta —
		// sem ela, o número menor apareceria sem explicação.
		expect(
			distanciaDoTrajeto({ origem: JUCAS, briefing: null, destino: ACOPIARA }, MATRIZ)
		).toEqual({
			km: 70,
			via: 'direto'
		});
	});

	it('briefing na mesma cidade da origem não soma nada', () => {
		expect(
			distanciaDoTrajeto({ origem: IGUATU, briefing: IGUATU, destino: ACOPIARA }, MATRIZ)
		).toEqual({ km: 37, via: 'briefing' });
	});

	it('origem igual ao destino é ZERO — uma medida, não uma falta dela', () => {
		expect(distanciaDoTrajeto({ origem: IGUATU, briefing: null, destino: IGUATU }, MATRIZ)).toEqual(
			{
				km: 0,
				via: 'direto'
			}
		);
	});

	describe('devolve null quando não dá para medir', () => {
		/**
		 * `null` mantém o campo manual, como era antes da matriz. Zero seria pior:
		 * zero é uma medida, e faria a tela sugerir hora extra como se a distância
		 * tivesse sido conferida e dado abaixo do limite.
		 */
		it('origem sem município', () => {
			expect(
				distanciaDoTrajeto({ origem: null, briefing: IGUATU, destino: ACOPIARA }, MATRIZ)
			).toBeNull();
		});

		it('destino sem município', () => {
			expect(
				distanciaDoTrajeto({ origem: JUCAS, briefing: IGUATU, destino: null }, MATRIZ)
			).toBeNull();
		});

		it('par ausente da matriz', () => {
			expect(
				distanciaDoTrajeto({ origem: JUCAS, briefing: null, destino: FORA_DA_MATRIZ }, MATRIZ)
			).toBeNull();
		});
	});

	it('perna faltando na matriz cai no direto, em vez de perder a medida', () => {
		expect(
			distanciaDoTrajeto({ origem: JUCAS, briefing: FORA_DA_MATRIZ, destino: ACOPIARA }, MATRIZ)
		).toEqual({ km: 70, via: 'direto' });
	});
});

describe('chaveDoPar', () => {
	it('é a mesma nos dois sentidos — a matriz guarda uma linha por par', () => {
		expect(chaveDoPar(IGUATU, JUCAS)).toBe(chaveDoPar(JUCAS, IGUATU));
	});
});
