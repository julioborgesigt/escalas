import { describe, it, expect } from 'vitest';
import { afastamentoVigente } from '../policial-historico';
import type { PolicialHistorico } from '../../server/schema';

/** Cria um evento de histórico mínimo para os testes (só os campos usados). */
function ev(p: Partial<PolicialHistorico>): PolicialHistorico {
	return {
		id: 1,
		policial_id: 1,
		tipo: 'afastamento',
		subtipo: 'ferias',
		descricao: null,
		unidade_origem: null,
		unidade_destino: null,
		data_evento: null,
		data_inicio: null,
		data_fim: null,
		qtd_dias: null,
		nup: null,
		documento_r2_key: null,
		documento_nome: null,
		dados_antes: null,
		dados_depois: null,
		registrado_por_id: null,
		registrado_por_nome: null,
		created_at: '2026-07-01 10:00:00',
		...p
	} as PolicialHistorico;
}

describe('afastamentoVigente', () => {
	it('detecta afastamento em curso hoje', () => {
		const hist = [ev({ id: 5, data_inicio: '2026-07-20', data_fim: '2026-07-30' })];
		expect(afastamentoVigente(hist, '2026-07-22')?.id).toBe(5);
	});

	it('inclui os extremos do período (início e fim)', () => {
		const hist = [ev({ id: 5, data_inicio: '2026-07-20', data_fim: '2026-07-30' })];
		expect(afastamentoVigente(hist, '2026-07-20')?.id).toBe(5);
		expect(afastamentoVigente(hist, '2026-07-30')?.id).toBe(5);
	});

	it('devolve null fora do período', () => {
		const hist = [ev({ id: 5, data_inicio: '2026-07-20', data_fim: '2026-07-30' })];
		expect(afastamentoVigente(hist, '2026-07-19')).toBeNull();
		expect(afastamentoVigente(hist, '2026-07-31')).toBeNull();
	});

	it('considera afastamento sem data_fim como aberto (vigente)', () => {
		const hist = [ev({ id: 7, data_inicio: '2026-07-01', data_fim: null })];
		expect(afastamentoVigente(hist, '2026-12-31')?.id).toBe(7);
	});

	it('ignora eventos que não são afastamento', () => {
		const hist = [
			ev({ id: 9, tipo: 'movimentacao', data_inicio: '2026-07-20', data_fim: '2026-07-30' })
		];
		expect(afastamentoVigente(hist, '2026-07-22')).toBeNull();
	});

	it('retorna o primeiro afastamento vigente da lista', () => {
		const hist = [
			ev({ id: 1, data_inicio: '2026-07-20', data_fim: '2026-07-25' }),
			ev({ id: 2, data_inicio: '2026-07-21', data_fim: '2026-07-24' })
		];
		expect(afastamentoVigente(hist, '2026-07-22')?.id).toBe(1);
	});
});
