import { describe, it, expect } from 'vitest';
import { agruparPorEtapa, ETAPA_SEM_NOME } from '../etapas-formulario';
import type { GiseModeloPerguntaConfig } from '$lib/types';

function pergunta(key: string, etapa?: string): GiseModeloPerguntaConfig {
	return {
		id: key.length,
		texto: key,
		tipo: 'texto',
		key,
		...(etapa === undefined ? {} : { etapa })
	};
}

describe('agruparPorEtapa', () => {
	it('devolve array vazio quando não há perguntas', () => {
		expect(agruparPorEtapa([])).toEqual([]);
	});

	it('modelo antigo (nenhuma etapa) vira uma etapa só — retrocompatibilidade', () => {
		const etapas = agruparPorEtapa([pergunta('a'), pergunta('b')]);
		expect(etapas).toHaveLength(1);
		expect(etapas[0].chave).toBe('');
		expect(etapas[0].titulo).toBe(ETAPA_SEM_NOME);
		expect(etapas[0].perguntas.map((p) => p.key)).toEqual(['a', 'b']);
	});

	it('ordena as etapas pela PRIMEIRA pergunta de cada uma, não alfabeticamente', () => {
		const etapas = agruparPorEtapa([
			pergunta('a', 'Viatura'),
			pergunta('b', 'Apreensões'),
			pergunta('c', 'Viatura')
		]);
		expect(etapas.map((e) => e.titulo)).toEqual(['Viatura', 'Apreensões']);
		// A pergunta fora de sequência volta para o grupo dela, preservando a ordem.
		expect(etapas[0].perguntas.map((p) => p.key)).toEqual(['a', 'c']);
	});

	it('apara espaços e trata "  " como ausência de etapa', () => {
		const etapas = agruparPorEtapa([pergunta('a', ' Viatura '), pergunta('b', '   ')]);
		expect(etapas.map((e) => e.chave)).toEqual(['Viatura', '']);
		expect(etapas[1].titulo).toBe(ETAPA_SEM_NOME);
	});

	it('perguntas sem etapa formam um grupo próprio, na posição em que aparecem', () => {
		const etapas = agruparPorEtapa([pergunta('a'), pergunta('b', 'Viatura'), pergunta('c')]);
		expect(etapas.map((e) => e.titulo)).toEqual([ETAPA_SEM_NOME, 'Viatura']);
		expect(etapas[0].perguntas.map((p) => p.key)).toEqual(['a', 'c']);
	});

	it('não perde nenhuma pergunta', () => {
		const entrada = [
			pergunta('a', 'X'),
			pergunta('b'),
			pergunta('c', 'Y'),
			pergunta('d', 'X'),
			pergunta('e')
		];
		const total = agruparPorEtapa(entrada).reduce((n, e) => n + e.perguntas.length, 0);
		expect(total).toBe(entrada.length);
	});
});
