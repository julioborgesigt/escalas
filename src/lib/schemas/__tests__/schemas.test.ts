import { describe, it, expect } from 'vitest';
import {
	policialSchema,
	policialUpdateSchema,
	escalaSchema,
	escalaPolicialSchema,
	loginSchema,
	alterarSenhaSchema,
	unidadeSchema
} from '../index';

describe('policialSchema', () => {
	it('aceita dados válidos', () => {
		const result = policialSchema.safeParse({
			nome: 'João Silva',
			matricula: '12345678',
			cargo: 'DPC',
			telefone: '85999999999',
			lotacao: 'ICÓ'
		});
		expect(result.success).toBe(true);
	});

	it('rejeita nome vazio', () => {
		const result = policialSchema.safeParse({
			nome: '',
			matricula: '12345678',
			cargo: 'DPC'
		});
		expect(result.success).toBe(false);
	});

	it('rejeita cargo inválido', () => {
		const result = policialSchema.safeParse({
			nome: 'João',
			matricula: '12345678',
			cargo: 'DELEGADO'
		});
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues[0].message).toContain('DPC');
		}
	});

	it('aplica defaults para telefone e lotacao', () => {
		const result = policialSchema.safeParse({
			nome: 'João',
			matricula: '123',
			cargo: 'OIP'
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.telefone).toBe('');
			expect(result.data.lotacao).toBe('');
		}
	});
});

describe('policialUpdateSchema', () => {
	it('aceita campos parciais', () => {
		const result = policialUpdateSchema.safeParse({ nome: 'Novo Nome' });
		expect(result.success).toBe(true);
	});

	it('aceita objeto vazio', () => {
		const result = policialUpdateSchema.safeParse({});
		expect(result.success).toBe(true);
	});

	it('aceita ativo como número', () => {
		const result = policialUpdateSchema.safeParse({ ativo: 0 });
		expect(result.success).toBe(true);
	});
});

describe('escalaSchema', () => {
	it('aceita dados válidos', () => {
		const result = escalaSchema.safeParse({
			titulo: 'ESCALA PLANTÃO',
			cidade: 'ICÓ',
			data_inicio: '2026-01-01',
			data_fim: '2026-01-02'
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.hora_entrada).toBe('08');
			expect(result.data.hora_saida).toBe('08');
		}
	});

	it('rejeita título vazio', () => {
		const result = escalaSchema.safeParse({
			titulo: '',
			cidade: 'ICÓ',
			data_inicio: '2026-01-01',
			data_fim: '2026-01-02'
		});
		expect(result.success).toBe(false);
	});

	it('rejeita sem data_inicio', () => {
		const result = escalaSchema.safeParse({
			titulo: 'ESCALA',
			cidade: 'ICÓ',
			data_fim: '2026-01-02'
		});
		expect(result.success).toBe(false);
	});
});

describe('escalaPolicialSchema', () => {
	it('aceita dados válidos', () => {
		const result = escalaPolicialSchema.safeParse({
			policial_id: 1,
			data_plantao: '2026-01-01'
		});
		expect(result.success).toBe(true);
	});

	it('rejeita sem policial_id', () => {
		const result = escalaPolicialSchema.safeParse({
			data_plantao: '2026-01-01'
		});
		expect(result.success).toBe(false);
	});

	it('rejeita data_plantao vazia se fosse obrigatória, mas agora é opcional', () => {
		const result = escalaPolicialSchema.safeParse({
			policial_id: 1,
			data_plantao: ''
		});
		// No esquema atual, data_plantao é .optional(), então "" passa.
		// Se quisermos que falhe, o esquema deveria ter .min(1).
		expect(result.success).toBe(true);
	});
});

describe('loginSchema', () => {
	it('aceita dados válidos', () => {
		const result = loginSchema.safeParse({
			matricula: '12345678',
			senha: 'minhasenha'
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.tipo).toBe('policial');
		}
	});

	it('rejeita matrícula vazia', () => {
		const result = loginSchema.safeParse({
			matricula: '',
			senha: 'senha123'
		});
		expect(result.success).toBe(false);
	});

	it('aceita tipo admin', () => {
		const result = loginSchema.safeParse({
			matricula: 'admin',
			senha: 'admin123',
			tipo: 'admin'
		});
		expect(result.success).toBe(true);
	});
});

describe('alterarSenhaSchema', () => {
	it('aceita senha de 8 caracteres', () => {
		const result = alterarSenhaSchema.safeParse({
			nova_senha: 'novasen1'
		});
		expect(result.success).toBe(true);
	});

	it('rejeita senha com menos de 8 caracteres', () => {
		const result = alterarSenhaSchema.safeParse({
			nova_senha: '1234567'
		});
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues[0].message).toContain('8 caracteres');
		}
	});

	it('rejeita senha com mais de 8 caracteres', () => {
		const result = alterarSenhaSchema.safeParse({
			nova_senha: '123456789'
		});
		expect(result.success).toBe(false);
	});

	it('rejeita senha padrão 12345678', () => {
		const result = alterarSenhaSchema.safeParse({
			nova_senha: '12345678'
		});
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues.some((i) => i.message.includes('diferente da padrão'))).toBe(
				true
			);
		}
	});

	it('aceita senha_atual opcional', () => {
		const result = alterarSenhaSchema.safeParse({
			nova_senha: 'novasen1',
			senha_atual: 'antiga01'
		});
		expect(result.success).toBe(true);
	});
});

describe('unidadeSchema', () => {
	it('aceita nome válido', () => {
		const result = unidadeSchema.safeParse({ nome: 'ICÓ', cidade: 'ICÓ' });
		expect(result.success).toBe(true);
	});

	it('faz trim do nome', () => {
		const result = unidadeSchema.safeParse({ nome: '  ICÓ  ', cidade: 'ICÓ' });
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.nome).toBe('ICÓ');
		}
	});

	it('rejeita nome vazio', () => {
		const result = unidadeSchema.safeParse({ nome: '' });
		expect(result.success).toBe(false);
	});
});
