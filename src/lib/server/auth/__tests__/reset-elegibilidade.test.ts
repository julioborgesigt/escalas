import { describe, it, expect } from 'vitest';
import { podeAutoatenderResetSenha } from '../reset-elegibilidade';

describe('podeAutoatenderResetSenha (SEC-29)', () => {
	it('e-mail pessoal verificado pelo titular: libera', () => {
		expect(
			podeAutoatenderResetSenha({ email_pessoal: 'a@b.com', email_pessoal_verificado: 1 })
		).toBe(true);
	});

	it('e-mail pessoal presente mas NÃO verificado: recusa', () => {
		expect(
			podeAutoatenderResetSenha({ email_pessoal: 'a@b.com', email_pessoal_verificado: 0 })
		).toBe(false);
	});

	it('sem e-mail pessoal: recusa mesmo com o flag ligado', () => {
		// O flag sozinho não é canal: sem endereço não há para onde mandar o OTP.
		expect(podeAutoatenderResetSenha({ email_pessoal: null, email_pessoal_verificado: 1 })).toBe(
			false
		);
	});

	it('e-mail pessoal vazio conta como ausente', () => {
		expect(podeAutoatenderResetSenha({ email_pessoal: '', email_pessoal_verificado: 1 })).toBe(
			false
		);
	});

	it('usuário inexistente: recusa', () => {
		expect(podeAutoatenderResetSenha(null)).toBe(false);
	});
});
