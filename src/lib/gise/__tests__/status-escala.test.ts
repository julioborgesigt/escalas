import { describe, it, expect } from 'vitest';
import { STATUS_ESCALA_ASSINADA, escalaGiseJaAssinada } from '../status-escala';

/**
 * A escada completa, na ordem, como fonte do teste — inclusive os degraus que
 * NÃO contam. Assim um status novo inserido no meio reprova aqui antes de
 * reprovar em produção.
 */
const ESCADA = [
	'em_definicao_supervisor',
	'em_preenchimento',
	'aguardando_assinatura',
	'em_andamento',
	'aguardando_relatorios',
	'aguardando_assinatura_relat',
	'pronta_para_finalizar',
	'finalizada'
] as const;

describe('escalaGiseJaAssinada', () => {
	it('recusa tudo até `aguardando_assinatura`, inclusive', () => {
		for (const status of ['em_definicao_supervisor', 'em_preenchimento', 'aguardando_assinatura']) {
			expect(escalaGiseJaAssinada(status), status).toBe(false);
		}
	});

	it('aceita de `em_andamento` em diante, inclusive `finalizada`', () => {
		for (const status of [
			'em_andamento',
			'aguardando_relatorios',
			'aguardando_assinatura_relat',
			'pronta_para_finalizar',
			'finalizada'
		]) {
			expect(escalaGiseJaAssinada(status), status).toBe(true);
		}
	});

	it('corta a escada num ponto só — nenhum degrau assinado antes de um não assinado', () => {
		const corte = ESCADA.map(escalaGiseJaAssinada);
		expect(corte).toEqual([false, false, false, true, true, true, true, true]);
	});

	it('recusa status desconhecido em vez de deixar passar', () => {
		expect(escalaGiseJaAssinada('')).toBe(false);
		expect(escalaGiseJaAssinada('cancelada')).toBe(false);
	});

	it('a constante cobre exatamente o trecho final da escada', () => {
		expect([...STATUS_ESCALA_ASSINADA]).toEqual(ESCADA.slice(3));
	});
});
