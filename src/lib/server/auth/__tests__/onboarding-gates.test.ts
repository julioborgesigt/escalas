import { describe, it, expect } from 'vitest';
import {
	pathnameNoEscopo,
	pathnameLivreEmPrimeiroAcesso,
	pathnameLivreDoTermo
} from '../onboarding-gates';

describe('pathnameNoEscopo', () => {
	it('casa a rota exata e as sub-rotas, não um prefixo colado', () => {
		expect(pathnameNoEscopo('/api/auth/logout', '/api/auth/logout')).toBe(true);
		expect(pathnameNoEscopo('/api/auth/logout/x', '/api/auth/logout')).toBe(true);
		expect(pathnameNoEscopo('/api/auth/logout-tudo', '/api/auth/logout')).toBe(false);
	});
});

describe('pathnameLivreEmPrimeiroAcesso (SEC-01)', () => {
	it('libera a troca de senha, o logout e a verificação do e-mail pessoal', () => {
		expect(pathnameLivreEmPrimeiroAcesso('/alterar-senha')).toBe(true);
		expect(pathnameLivreEmPrimeiroAcesso('/api/auth/logout')).toBe(true);
		expect(pathnameLivreEmPrimeiroAcesso('/api/auth/solicitar-verificacao-email-pessoal')).toBe(
			true
		);
		expect(pathnameLivreEmPrimeiroAcesso('/api/auth/confirmar-verificacao-email-pessoal')).toBe(
			true
		);
	});

	it('recusa assinatura, troca de modo e o restante de /api/auth', () => {
		expect(pathnameLivreEmPrimeiroAcesso('/api/auth/solicitar-codigo-assinatura')).toBe(false);
		expect(pathnameLivreEmPrimeiroAcesso('/api/auth/alternar-acesso')).toBe(false);
		expect(pathnameLivreEmPrimeiroAcesso('/api/auth/reautenticar-assinatura')).toBe(false);
		expect(pathnameLivreEmPrimeiroAcesso('/api/escalas/1/preparar-assinatura')).toBe(false);
		expect(pathnameLivreEmPrimeiroAcesso('/escalas')).toBe(false);
	});
});

describe('pathnameLivreDoTermo (SEC-05)', () => {
	it('libera aceite, senha, consulta do termo e logout — não o prefixo /api/auth inteiro', () => {
		expect(pathnameLivreDoTermo('/aceitar-termo')).toBe(true);
		expect(pathnameLivreDoTermo('/alterar-senha')).toBe(true);
		expect(pathnameLivreDoTermo('/termo/v1')).toBe(true);
		expect(pathnameLivreDoTermo('/api/auth/logout')).toBe(true);
		expect(pathnameLivreDoTermo('/api/auth/alternar-acesso')).toBe(false);
		expect(pathnameLivreDoTermo('/api/auth/solicitar-codigo-assinatura')).toBe(false);
		expect(pathnameLivreDoTermo('/api/auth/reautenticar-assinatura')).toBe(false);
	});
});
