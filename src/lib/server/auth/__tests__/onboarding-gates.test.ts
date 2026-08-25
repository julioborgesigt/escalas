import { describe, it, expect } from 'vitest';
import {
	pathnameNoEscopo,
	pathnameLivreEmPrimeiroAcesso,
	pathnameLivreDoTermo,
	impoeAceiteDoTermo
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

describe('impoeAceiteDoTermo — os dois portões são FASES', () => {
	const OTP_EMAIL = [
		'/api/auth/solicitar-verificacao-email-pessoal',
		'/api/auth/confirmar-verificacao-email-pessoal'
	];

	it('em primeiro acesso, não impõe o termo em NENHUMA rota', () => {
		// A superfície já está reduzida por `pathnameLivreEmPrimeiroAcesso`; o
		// termo só teria a acrescentar um 403 sem saída — `/aceitar-termo` é
		// inalcançável enquanto a fase 1 não fecha.
		for (const rota of [
			'/alterar-senha',
			...OTP_EMAIL,
			'/api/auth/logout',
			'/escalas',
			'/api/escalas/1/assinar-simples'
		]) {
			expect(impoeAceiteDoTermo(rota, true)).toBe(false);
		}
	});

	it('o OTP do e-mail pessoal não morria por rota, e sim por fase', () => {
		// O bug: a TELA estava livre do termo e as duas APIs que ela chama não —
		// "Enviar código" respondia 403 no meio do primeiro acesso.
		for (const rota of OTP_EMAIL) {
			expect(impoeAceiteDoTermo(rota, true)).toBe(false);
			// Fora do onboarding elas voltam a exigir o aceite: trocar o canal de
			// recuperação com um termo novo pendente não é onboarding.
			expect(impoeAceiteDoTermo(rota, false)).toBe(true);
		}
	});

	it('resolvido o primeiro acesso, vale a allowlist do termo', () => {
		expect(impoeAceiteDoTermo('/aceitar-termo', false)).toBe(false);
		expect(impoeAceiteDoTermo('/alterar-senha', false)).toBe(false);
		expect(impoeAceiteDoTermo('/termo/v1', false)).toBe(false);
		expect(impoeAceiteDoTermo('/api/auth/logout', false)).toBe(false);
		expect(impoeAceiteDoTermo('/escalas', false)).toBe(true);
		expect(impoeAceiteDoTermo('/api/auth/alternar-acesso', false)).toBe(true);
	});
});
