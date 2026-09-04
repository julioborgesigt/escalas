/**
 * `lerEquipe` — a lista fechada do `<select>` de equipe, repetida no servidor.
 *
 * O campo é um `<select>` de 1 a 5 e a coluna é `text NOT NULL DEFAULT ''`:
 * antes desta leva, `equipe=999` era gravado e saía impresso no PDF da escala.
 * Três actions leem o campo (`adicionar`, `adicionarPlantao`, `repetir`), e é
 * por isso que a regra mora em `shared.ts` em vez de em cada uma.
 */

import { describe, it, expect } from 'vitest';
import { lerEquipe, MAX_EQUIPE_ESCALA } from '../shared';

function fd(pares: Record<string, string>): FormData {
	const f = new FormData();
	for (const [k, v] of Object.entries(pares)) f.append(k, v);
	return f;
}

describe('lerEquipe', () => {
	it('aceita a faixa que a tela oferece', () => {
		for (let n = 1; n <= MAX_EQUIPE_ESCALA; n++) {
			expect(lerEquipe(fd({ equipe: String(n) })), `equipe ${n}`).toBe(String(n));
		}
	});

	it("ausente ou vazio é `''` — sem equipe é resposta legítima", () => {
		// Em expediente o `<select>` nem renderiza. Tratar isso como erro
		// transformaria o caminho normal da tela em recusa.
		expect(lerEquipe(new FormData())).toBe('');
		expect(lerEquipe(fd({ equipe: '' }))).toBe('');
		expect(lerEquipe(fd({ equipe: '   ' }))).toBe('');
	});

	it('recusa fora da faixa — é o valor que era gravado e impresso', () => {
		expect(lerEquipe(fd({ equipe: '999' }))).toBeNull();
		expect(lerEquipe(fd({ equipe: '0' }))).toBeNull();
		expect(lerEquipe(fd({ equipe: '-1' }))).toBeNull();
		expect(lerEquipe(fd({ equipe: String(MAX_EQUIPE_ESCALA + 1) }))).toBeNull();
	});

	it('recusa o que não é número inteiro', () => {
		expect(lerEquipe(fd({ equipe: 'Equipe 1' }))).toBeNull();
		expect(lerEquipe(fd({ equipe: '1.5' }))).toBeNull();
		// `Number('0x2')` é 2 e `Number('1e0')` é 1 — nenhuma das duas sai de um
		// `<select>`, e `inteiroNaFaixa` recusa as duas por isso.
		expect(lerEquipe(fd({ equipe: '0x2' }))).toBeNull();
		expect(lerEquipe(fd({ equipe: '1e0' }))).toBeNull();
	});

	it('devolve TEXTO, que é o tipo da coluna', () => {
		// A coluna é `text`; devolver número faria o Drizzle gravar '1' em um sítio
		// e 1 em outro, e a comparação de equipe passa a depender de qual gravou.
		expect(typeof lerEquipe(fd({ equipe: '3' }))).toBe('string');
	});
});
