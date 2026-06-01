import { describe, it, expect } from 'vitest';
import {
	novoIncidenteSchema,
	atualizarIncidenteSchema,
	responderSolicitacaoSchema,
	novaSolicitacaoTitularSchema
} from '../lgpd';

const incidenteValido = {
	titulo: 'Acesso indevido ao painel',
	descricao: 'Usuário não autorizado acessou área restrita por 5 minutos.',
	tipo_incidente: 'acesso_nao_autorizado' as const,
	data_descoberta: '2026-05-15T10:00:00Z',
	dados_afetados: 'Lista de matrículas de 30 policiais',
	gravidade: 'media' as const,
	responsavel_nome: 'Encarregado LGPD',
	responsavel_email: 'lgpd@pc.ce.gov.br'
};

describe('novoIncidenteSchema', () => {
	it('aceita payload mínimo válido', () => {
		const r = novoIncidenteSchema.safeParse(incidenteValido);
		expect(r.success).toBe(true);
	});

	it('REJEITA gravidade fora do enum (antes virava string crua no banco)', () => {
		const r = novoIncidenteSchema.safeParse({ ...incidenteValido, gravidade: 'catastrofica' });
		expect(r.success).toBe(false);
	});

	it('REJEITA tipo_incidente fora do enum', () => {
		const r = novoIncidenteSchema.safeParse({ ...incidenteValido, tipo_incidente: 'invasao' });
		expect(r.success).toBe(false);
	});

	it('REJEITA descrição abaixo de 10 chars', () => {
		const r = novoIncidenteSchema.safeParse({ ...incidenteValido, descricao: 'curto' });
		expect(r.success).toBe(false);
	});

	it('REJEITA responsavel_email inválido', () => {
		const r = novoIncidenteSchema.safeParse({
			...incidenteValido,
			responsavel_email: 'not-an-email'
		});
		expect(r.success).toBe(false);
	});

	it('REJEITA usuarios_afetados_estimativa absurdo (anti-DoS)', () => {
		const r = novoIncidenteSchema.safeParse({
			...incidenteValido,
			usuarios_afetados_estimativa: 999_999_999
		});
		expect(r.success).toBe(false);
	});

	it('STRIP de campos extras (mass-assignment de created_by_id)', () => {
		const r = novoIncidenteSchema.safeParse({
			...incidenteValido,
			created_by_id: 999,
			created_by_nome: 'Atacante'
		});
		expect(r.success).toBe(true);
		if (r.success) {
			expect('created_by_id' in r.data).toBe(false);
			expect('created_by_nome' in r.data).toBe(false);
		}
	});
});

describe('atualizarIncidenteSchema', () => {
	it('aceita PATCH com pelo menos 1 campo', () => {
		const r = atualizarIncidenteSchema.safeParse({ status: 'investigando' });
		expect(r.success).toBe(true);
	});

	it('REJEITA PATCH vazio (refine: ao menos 1 campo)', () => {
		const r = atualizarIncidenteSchema.safeParse({});
		expect(r.success).toBe(false);
	});

	it('REJEITA status inválido', () => {
		const r = atualizarIncidenteSchema.safeParse({ status: 'pendente_revisao' });
		expect(r.success).toBe(false);
	});
});

describe('responderSolicitacaoSchema', () => {
	it('aceita resposta com status válido', () => {
		const r = responderSolicitacaoSchema.safeParse({
			status: 'concluida',
			resposta: 'Dados eliminados conforme art. 18'
		});
		expect(r.success).toBe(true);
	});

	it('REJEITA status "pendente" (o titular já começa pendente; só admin transiciona para outros)', () => {
		const r = responderSolicitacaoSchema.safeParse({
			status: 'pendente',
			resposta: 'x'
		});
		expect(r.success).toBe(false);
	});

	it('REJEITA resposta vazia', () => {
		const r = responderSolicitacaoSchema.safeParse({ status: 'concluida', resposta: '' });
		expect(r.success).toBe(false);
	});
});

describe('novaSolicitacaoTitularSchema', () => {
	it('aceita tipo válido', () => {
		const r = novaSolicitacaoTitularSchema.safeParse({ tipo_direito: 'acesso' });
		expect(r.success).toBe(true);
	});

	it('REJEITA tipo fora dos 8 direitos LGPD', () => {
		const r = novaSolicitacaoTitularSchema.safeParse({ tipo_direito: 'tudo' });
		expect(r.success).toBe(false);
	});

	it('STRIP de campos extras (mass-assignment de solicitante_id)', () => {
		const r = novaSolicitacaoTitularSchema.safeParse({
			tipo_direito: 'acesso',
			solicitante_id: 999,
			solicitante_nome: 'Outro'
		});
		expect(r.success).toBe(true);
		if (r.success) {
			expect('solicitante_id' in r.data).toBe(false);
			expect('solicitante_nome' in r.data).toBe(false);
		}
	});
});
