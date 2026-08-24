import { describe, it, expect } from 'vitest';
import { identidadeVisualAssinante } from '../identidade-sessao';

describe('identidadeVisualAssinante (SEC-07)', () => {
	it('usa nome e CPF da sessão, sem fallback vazio no nome', () => {
		expect(identidadeVisualAssinante({ nome: 'FULANO DE TAL', cpf: '12345678901' })).toEqual({
			signerName: 'FULANO DE TAL',
			signerCpf: '12345678901'
		});
	});

	it('CPF ausente vira string vazia, não o que o cliente mandaria', () => {
		expect(identidadeVisualAssinante({ nome: 'BELTRANO', cpf: '  ' })).toEqual({
			signerName: 'BELTRANO',
			signerCpf: ''
		});
		expect(identidadeVisualAssinante({ nome: 'BELTRANO', cpf: null })).toEqual({
			signerName: 'BELTRANO',
			signerCpf: ''
		});
	});
});
