import { describe, it, expect } from 'vitest';
import {
	textoLimitado,
	textoLimitadoOuNulo,
	inteiroNaFaixa,
	dataIso,
	horaHhMm,
	MAX_EMAIL,
	MAX_OBSERVACOES
} from '../form-data';

function fd(pares: Record<string, string>): FormData {
	const f = new FormData();
	for (const [k, v] of Object.entries(pares)) f.append(k, v);
	return f;
}

describe('textoLimitado', () => {
	it('corta no limite — é o cap que o `maxlength` da tela só promete', () => {
		expect(textoLimitado(fd({ obs: 'a'.repeat(5000) }), 'obs', MAX_OBSERVACOES)).toHaveLength(500);
	});

	it('apara antes de cortar, para o limite valer sobre o conteúdo', () => {
		expect(textoLimitado(fd({ x: '   ab   ' }), 'x', 10)).toBe('ab');
	});

	it('texto dentro do limite passa intacto', () => {
		expect(textoLimitado(fd({ x: 'Plantão 24h' }), 'x', 500)).toBe('Plantão 24h');
	});

	it('campo ausente vira string vazia, nunca undefined', () => {
		expect(textoLimitado(fd({}), 'inexistente', 100)).toBe('');
	});

	it('limite exato não corta nada', () => {
		expect(textoLimitado(fd({ x: 'abcde' }), 'x', 5)).toBe('abcde');
	});
});

describe('textoLimitadoOuNulo', () => {
	it('vazio e só-espaços viram null (coluna anulável = "não informado")', () => {
		expect(textoLimitadoOuNulo(fd({ x: '' }), 'x', 100)).toBeNull();
		expect(textoLimitadoOuNulo(fd({ x: '     ' }), 'x', 100)).toBeNull();
		expect(textoLimitadoOuNulo(fd({}), 'x', 100)).toBeNull();
	});

	it('com conteúdo, corta igual ao `textoLimitado`', () => {
		expect(textoLimitadoOuNulo(fd({ x: 'b'.repeat(300) }), 'x', 200)).toHaveLength(200);
	});
});

describe('MAX_EMAIL', () => {
	it('é o limite da RFC 5321 — o regex de e-mail não impõe tamanho nenhum', () => {
		const gigante = 'a'.repeat(5000) + '@b.com';
		expect(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(gigante)).toBe(true);
		expect(textoLimitado(fd({ e: gigante }), 'e', MAX_EMAIL)).toHaveLength(254);
	});
});

describe('inteiroNaFaixa', () => {
	it('aceita dentro da faixa, extremos incluídos', () => {
		expect(inteiroNaFaixa(fd({ v: '0' }), 'v', 0, 20)).toBe(0);
		expect(inteiroNaFaixa(fd({ v: '20' }), 'v', 0, 20)).toBe(20);
		expect(inteiroNaFaixa(fd({ v: '7' }), 'v', 0, 20)).toBe(7);
	});

	it('recusa fora da faixa — as vagas entram numa comparação SQL de lotação', () => {
		// `999999` apagava o controle de vaga (`COUNT(*) < slots`); `-1` fazia a
		// equipe recusar todo mundo dizendo "vagas esgotadas".
		expect(inteiroNaFaixa(fd({ v: '999999' }), 'v', 0, 20)).toBeNull();
		expect(inteiroNaFaixa(fd({ v: '-1' }), 'v', 0, 20)).toBeNull();
		expect(inteiroNaFaixa(fd({ v: '21' }), 'v', 0, 20)).toBeNull();
	});

	it('recusa não-inteiro e lixo', () => {
		// `0x10` e `1e3` entram na lista de propósito: `Number()` os aceita (16 e
		// 1000), e nenhum sai de um `<input type="number">`.
		for (const ruim of ['1.5', 'abc', 'NaN', 'Infinity', '1e3', '0x10', '  ', '2,5', '+5']) {
			expect(inteiroNaFaixa(fd({ v: ruim }), 'v', 0, 20), ruim).toBeNull();
		}
	});

	it('apara espaços, como o `textoLimitado` — FormData traz o que a tela mandou', () => {
		expect(inteiroNaFaixa(fd({ v: ' 5 ' }), 'v', 0, 20)).toBe(5);
	});

	it('ausente e vazio devolvem null — o chamador distingue de zero', () => {
		expect(inteiroNaFaixa(fd({}), 'v', 0, 20)).toBeNull();
		expect(inteiroNaFaixa(fd({ v: '' }), 'v', 0, 20)).toBeNull();
		// `0` é uma AFIRMAÇÃO (equipe sem aquela vaga), não ausência.
		expect(inteiroNaFaixa(fd({ v: '0' }), 'v', 0, 20)).toBe(0);
	});
});

describe('dataIso', () => {
	it('aceita a data que `<input type="date">` emite', () => {
		expect(dataIso(fd({ d: '2026-09-04' }), 'd')).toBe('2026-09-04');
	});

	it('recusa data que só PARECE data — 31 de fevereiro passa no regex', () => {
		// É o caso que motiva conferir o calendário: casa com
		// /^\d{4}-\d{2}-\d{2}$/, e `new Date` normaliza para 03/03 sem lançar.
		expect(dataIso(fd({ d: '2026-02-31' }), 'd')).toBeNull();
		expect(dataIso(fd({ d: '2026-13-01' }), 'd')).toBeNull();
		expect(dataIso(fd({ d: '2026-00-10' }), 'd')).toBeNull();
	});

	it('recusa formato fora do que a tela produz', () => {
		expect(dataIso(fd({ d: '04/09/2026' }), 'd')).toBeNull();
		expect(dataIso(fd({ d: '2026-9-4' }), 'd')).toBeNull();
		expect(dataIso(fd({ d: '2026-09-04T00:00' }), 'd')).toBeNull();
		expect(dataIso(fd({ d: 'banana' }), 'd')).toBeNull();
	});

	it('ausente e vazio viram null', () => {
		expect(dataIso(new FormData(), 'd')).toBeNull();
		expect(dataIso(fd({ d: '   ' }), 'd')).toBeNull();
	});

	it('o valor que fazia o portão de presença liberar é recusado na escrita', () => {
		// `horarioGiseLiberado` faz `new Date(`${dataInicio}T...`)` e libera quando
		// dá Invalid Date (fail-open deliberado). Estes são os valores que chegavam
		// lá; agora morrem na action.
		for (const ruim of ['banana', '0000-00-00', '2026-02-30', '']) {
			expect(dataIso(fd({ d: ruim }), 'd'), ruim).toBeNull();
		}
	});
});

describe('horaHhMm', () => {
	it('aceita a hora que `<input type="time">` emite', () => {
		expect(horaHhMm(fd({ h: '08:00' }), 'h')).toBe('08:00');
		expect(horaHhMm(fd({ h: '00:00' }), 'h')).toBe('00:00');
		expect(horaHhMm(fd({ h: '23:59' }), 'h')).toBe('23:59');
	});

	it('recusa hora fora da faixa do relógio', () => {
		expect(horaHhMm(fd({ h: '24:00' }), 'h')).toBeNull();
		expect(horaHhMm(fd({ h: '08:60' }), 'h')).toBeNull();
		expect(horaHhMm(fd({ h: '99:99' }), 'h')).toBeNull();
	});

	it('aceita `H:MM` — é o que a tela manda — e NORMALIZA para `HH:MM`', () => {
		// `validarHora` do cliente testa /^\d{1,2}:\d{2}$/ e `normalizarHora` não
		// preenche o zero: `8:00` sai do formulário legítimo. Exigir dois dígitos
		// recusaria quem digitou certo.
		expect(horaHhMm(fd({ h: '8:00' }), 'h')).toBe('08:00');
		expect(horaHhMm(fd({ h: '7:30' }), 'h')).toBe('07:30');
		// Normalizar na escrita é o que impede o banco de guardar `8:00` numa linha
		// e `08:00` na outra para o mesmo horário.
		expect(horaHhMm(fd({ h: '08:00' }), 'h')).toBe('08:00');
	});

	it('recusa grafia que a tela não produz', () => {
		// `'08'` (só a hora) é a convenção das colunas de escala ordinária, não da
		// GISE — aceitar as duas aqui recriaria a divergência que o CLAUDE.md
		// cataloga na família "fallback de hora do plantão".
		expect(horaHhMm(fd({ h: '08' }), 'h')).toBeNull();
		expect(horaHhMm(fd({ h: '08:00:00' }), 'h')).toBeNull();
		expect(horaHhMm(fd({ h: '8h00' }), 'h')).toBeNull();
		expect(horaHhMm(fd({ h: 'meio-dia' }), 'h')).toBeNull();
	});

	it('ausente e vazio viram null', () => {
		expect(horaHhMm(new FormData(), 'h')).toBeNull();
		expect(horaHhMm(fd({ h: '' }), 'h')).toBeNull();
	});
});
