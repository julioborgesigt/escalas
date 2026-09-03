import { describe, it, expect } from 'vitest';
import { podeBaixarForense, cpfAssinanteParaExibir } from '../cpf-assinante';
import type { UsuarioLogado } from '$lib/auth';

/**
 * `cpfAssinanteParaExibir` roda SEM chave de cifragem no ambiente de teste, e é
 * o caso que importa medir: `decifrarCpfDoDB` devolve o valor como está quando
 * não há `CPF_ENCRYPTION_KEY`, então o que este teste isola é a MÁSCARA — a
 * metade que os dois `load` não aplicavam.
 */
const SEM_CHAVE = undefined;
const CPF = '12345678901';

function usuario(over: Partial<UsuarioLogado> = {}): UsuarioLogado {
	return {
		id: 1,
		tipo: 'policial',
		nome: 'MARCOS SANDRO LIRA',
		primeiro_acesso: false,
		...over
	};
}

describe('podeBaixarForense', () => {
	it('só o Super Admin', () => {
		expect(podeBaixarForense(usuario({ isSuperAdmin: true }))).toBe(true);
		expect(podeBaixarForense(usuario({ isSuperAdmin: false }))).toBe(false);
		expect(podeBaixarForense(usuario())).toBe(false);
	});

	it('Admin Geral NÃO basta — é o gate mais restrito que o do manifesto', () => {
		expect(podeBaixarForense(usuario({ tipo: 'admin' }))).toBe(false);
	});

	it('sessão ausente é recusa, sem lançar', () => {
		expect(podeBaixarForense(null)).toBe(false);
		expect(podeBaixarForense(undefined)).toBe(false);
	});
});

describe('cpfAssinanteParaExibir', () => {
	it('Super Admin vê o CPF completo', async () => {
		await expect(
			cpfAssinanteParaExibir(CPF, SEM_CHAVE, usuario({ isSuperAdmin: true }))
		).resolves.toBe(CPF);
	});

	it('mascara para policial comum', async () => {
		await expect(cpfAssinanteParaExibir(CPF, SEM_CHAVE, usuario())).resolves.toBe('***.456.***-**');
	});

	it('mascara para Admin Geral e para admin de seccional', async () => {
		await expect(cpfAssinanteParaExibir(CPF, SEM_CHAVE, usuario({ tipo: 'admin' }))).resolves.toBe(
			'***.456.***-**'
		);
		await expect(
			cpfAssinanteParaExibir(CPF, SEM_CHAVE, usuario({ papel: 'admin_seccional' }))
		).resolves.toBe('***.456.***-**');
	});

	it('mascara para visitante sem sessão', async () => {
		await expect(cpfAssinanteParaExibir(CPF, SEM_CHAVE, null)).resolves.toBe('***.456.***-**');
	});

	it('CPF ausente sai vazio, sem lançar', async () => {
		await expect(cpfAssinanteParaExibir(null, SEM_CHAVE, usuario())).resolves.toBe('');
		await expect(cpfAssinanteParaExibir(undefined, SEM_CHAVE, usuario())).resolves.toBe('');
		await expect(
			cpfAssinanteParaExibir('', SEM_CHAVE, usuario({ isSuperAdmin: true }))
		).resolves.toBe('');
	});

	it('o mascarado NÃO contém nenhum dígito fora dos três do meio', async () => {
		const saida = await cpfAssinanteParaExibir(CPF, SEM_CHAVE, usuario());
		expect(saida).not.toContain('123');
		expect(saida).not.toContain('789');
		expect(saida).not.toContain('01');
	});
});
