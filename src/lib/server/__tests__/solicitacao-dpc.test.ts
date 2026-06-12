import { describe, it, expect } from 'vitest';
import { solicitacaoConcedeAcessoDpc } from '../../db/escalas';

/**
 * Regra de acesso de admin DPC via solicitação de assinatura (fix do IDOR A1).
 * O ramo `unidade` só concede acesso quando a lotação da escala está dentro do
 * escopo administrativo (lotacoesPermitidas); a `respondencia` nominal vale
 * mesmo fora do escopo.
 */
describe('solicitacaoConcedeAcessoDpc', () => {
	it('sem solicitação → false', () => {
		expect(solicitacaoConcedeAcessoDpc(undefined, 1, 'DELEGACIA A', ['DELEGACIA A'])).toBe(false);
	});

	it('respondencia nominal ao próprio usuário → true (mesmo fora de escopo)', () => {
		expect(
			solicitacaoConcedeAcessoDpc(
				{ tipo: 'respondencia', destinatario_id: 7 },
				7,
				'DELEGACIA X',
				[]
			)
		).toBe(true);
	});

	it('respondencia direcionada a OUTRO usuário → false', () => {
		expect(
			solicitacaoConcedeAcessoDpc({ tipo: 'respondencia', destinatario_id: 9 }, 7, 'DELEGACIA X', [
				'DELEGACIA X'
			])
		).toBe(false);
	});

	it('unidade com escala DENTRO do escopo → true', () => {
		expect(
			solicitacaoConcedeAcessoDpc({ tipo: 'unidade', destinatario_id: null }, 7, 'DELEGACIA A', [
				'DELEGACIA A',
				'DELEGACIA B'
			])
		).toBe(true);
	});

	it('unidade com escala FORA do escopo → false (IDOR fechado)', () => {
		expect(
			solicitacaoConcedeAcessoDpc({ tipo: 'unidade', destinatario_id: null }, 7, 'DELEGACIA X', [
				'DELEGACIA A',
				'DELEGACIA B'
			])
		).toBe(false);
	});

	it('unidade sem lotacoesPermitidas → false', () => {
		expect(
			solicitacaoConcedeAcessoDpc(
				{ tipo: 'unidade', destinatario_id: null },
				7,
				'DELEGACIA X',
				undefined
			)
		).toBe(false);
	});

	it('unidade sem escalaLotacao → false', () => {
		expect(
			solicitacaoConcedeAcessoDpc({ tipo: 'unidade', destinatario_id: null }, 7, undefined, [
				'DELEGACIA A'
			])
		).toBe(false);
	});
});
