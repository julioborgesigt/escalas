import { describe, it, expect } from 'vitest';
import { renumerarPerguntas } from './renumerar-perguntas';
import type { GiseModeloPerguntaConfig } from '$lib/types';

function p(texto: string, extra: Partial<GiseModeloPerguntaConfig> = {}): GiseModeloPerguntaConfig {
	return { id: 1, key: 'k', tipo: 'texto', texto, ...extra };
}

describe('renumerarPerguntas', () => {
	it('renumera o prefixo do texto pela posição', () => {
		const r = renumerarPerguntas([p('4. Houve PROCEDIMENTO?'), p('8. Houve tentativa?')]);
		expect(r.map((q) => q.texto)).toEqual(['1. Houve PROCEDIMENTO?', '2. Houve tentativa?']);
	});

	it('leva os sub-rótulos junto, preservando a ordem DENTRO do bloco', () => {
		const [r] = renumerarPerguntas([
			p('4. Houve PRISÕES?', {
				subtexto_qtd: '4.1 QUANTIDADE:',
				subtexto_lista: '4.2 INFORMAR NOMES E PROCEDIMENTOS:'
			})
		]);
		expect(r.texto).toBe('1. Houve PRISÕES?');
		expect(r.subtexto_qtd).toBe('1.1 QUANTIDADE:');
		expect(r.subtexto_lista).toBe('1.2 INFORMAR NOMES E PROCEDIMENTOS:');
	});

	it('troca só o PRIMEIRO segmento em rótulo de três níveis', () => {
		const lista = [p('a'), p('b'), p('10. Drogas?', { subtexto_detalhe: '10.1.1 PESOS:' })];
		const r = renumerarPerguntas(lista);
		expect(r[2].subtexto_detalhe).toBe('3.1.1 PESOS:');
	});

	it('número de dois dígitos vira um dígito e vice-versa', () => {
		const doze = Array.from({ length: 12 }, (_, i) => p(`1. Pergunta ${i}`));
		const r = renumerarPerguntas(doze);
		expect(r[9].texto).toBe('10. Pergunta 9');
		expect(r[11].texto).toBe('12. Pergunta 11');
	});

	it('texto sem número não é tocado', () => {
		const r = renumerarPerguntas([p('Quantos?'), p('Descreva as diligências')]);
		expect(r.map((q) => q.texto)).toEqual(['Quantos?', 'Descreva as diligências']);
	});

	it('número SEM ponto não é tocado — não reescreve prosa por engano', () => {
		const r = renumerarPerguntas([p('2026 foi o ano de referência')]);
		expect(r[0].texto).toBe('2026 foi o ano de referência');
	});

	it('filho numerado acompanha o pai; filho sem número fica como está', () => {
		const [r] = renumerarPerguntas([
			p('8. Houve tentativa?', {
				filhos: [p('8.1 Quantas?'), p('Quantos?')]
			})
		]);
		expect(r.filhos?.[0].texto).toBe('1.1 Quantas?');
		expect(r.filhos?.[1].texto).toBe('Quantos?');
	});

	it('é idempotente', () => {
		const uma = renumerarPerguntas([p('4. A', { subtexto_qtd: '4.1 x' }), p('9. B')]);
		expect(renumerarPerguntas(uma)).toEqual(uma);
	});

	it('não muta a entrada — o editor depende da troca de referência', () => {
		const original = [p('4. A', { subtexto_qtd: '4.1 x' })];
		const copia = structuredClone(original);
		renumerarPerguntas(original);
		expect(original).toEqual(copia);
	});

	it('preserva os demais campos da pergunta', () => {
		const [r] = renumerarPerguntas([
			p('4. A', {
				key: 'extra_9',
				tipo: 'lista_detalhada',
				etapa: 'Ocorrências',
				obrigatoria: true
			})
		]);
		expect(r).toMatchObject({
			key: 'extra_9',
			tipo: 'lista_detalhada',
			etapa: 'Ocorrências',
			obrigatoria: true
		});
	});

	it('lista vazia devolve lista vazia', () => {
		expect(renumerarPerguntas([])).toEqual([]);
	});
});
