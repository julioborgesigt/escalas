import { describe, it, expect } from 'vitest';
import { movimentacaoSchema, afastamentoSchema, desvinculacaoSchema } from '../policial-historico';

describe('movimentacaoSchema', () => {
	it('aceita movimentação válida com NUP', () => {
		const r = movimentacaoSchema.safeParse({
			unidade_destino: 'Delegacia de Icó',
			data_evento: '2026-07-22',
			nup: '00000.000000/0000-00'
		});
		expect(r.success).toBe(true);
	});

	it('aceita NUP vazio (opcional)', () => {
		const r = movimentacaoSchema.safeParse({
			unidade_destino: 'Delegacia de Icó',
			data_evento: '2026-07-22',
			nup: ''
		});
		expect(r.success).toBe(true);
	});

	it('rejeita NUP mal formatado', () => {
		const r = movimentacaoSchema.safeParse({
			unidade_destino: 'Delegacia de Icó',
			data_evento: '2026-07-22',
			nup: '123'
		});
		expect(r.success).toBe(false);
	});

	it('exige unidade de destino', () => {
		const r = movimentacaoSchema.safeParse({ unidade_destino: '', data_evento: '2026-07-22' });
		expect(r.success).toBe(false);
	});

	it('rejeita data em formato inválido', () => {
		const r = movimentacaoSchema.safeParse({
			unidade_destino: 'Delegacia de Icó',
			data_evento: '22/07/2026'
		});
		expect(r.success).toBe(false);
	});
});

describe('afastamentoSchema', () => {
	it('aceita afastamento de férias com quantidade de dias', () => {
		const r = afastamentoSchema.safeParse({
			subtipo: 'ferias',
			descricao: 'Férias regulamentares',
			data_inicio: '2026-07-01',
			data_fim: '2026-07-30',
			qtd_dias: '30',
			nup: ''
		});
		expect(r.success).toBe(true);
		if (r.success) expect(r.data.qtd_dias).toBe(30);
	});

	it('rejeita subtipo desconhecido', () => {
		const r = afastamentoSchema.safeParse({
			subtipo: 'inexistente',
			data_inicio: '2026-07-01',
			data_fim: '2026-07-30'
		});
		expect(r.success).toBe(false);
	});

	it('torna qtd_dias e descrição opcionais', () => {
		const r = afastamentoSchema.safeParse({
			subtipo: 'licenca_medica',
			data_inicio: '2026-07-01',
			data_fim: '2026-07-05'
		});
		expect(r.success).toBe(true);
	});
});

describe('desvinculacaoSchema', () => {
	it('aceita desvinculação válida', () => {
		const r = desvinculacaoSchema.safeParse({
			destino: 'Polícia Militar do Ceará',
			data_evento: '2026-07-22',
			nup: ''
		});
		expect(r.success).toBe(true);
	});

	it('exige destino do policial', () => {
		const r = desvinculacaoSchema.safeParse({ destino: '', data_evento: '2026-07-22' });
		expect(r.success).toBe(false);
	});
});
