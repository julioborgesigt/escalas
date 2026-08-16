import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
	lerReauthGuardado,
	gravarReauth,
	apagarReauth,
	ehErroReauthAssinatura,
	ERRO_REAUTH_AUSENTE,
	ERRO_REAUTH_INVALIDA,
	REAUTH_VALIDADE_MS
} from '$lib/assinatura-reauth';

const ID = 'ab'.repeat(32);

function mockStorage() {
	const mem = new Map<string, string>();
	vi.stubGlobal('sessionStorage', {
		getItem: (k: string) => mem.get(k) ?? null,
		setItem: (k: string, v: string) => {
			mem.set(k, v);
		},
		removeItem: (k: string) => {
			mem.delete(k);
		}
	});
	return mem;
}

describe('cache da janela de senha no pad', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-08-16T12:00:00.000Z'));
		mockStorage();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it('grava com expiração e devolve o id enquanto vale', () => {
		gravarReauth(ID);
		expect(lerReauthGuardado()).toBe(ID);
	});

	it('hex cru (formato antigo, sem exp) não autoriza pular a senha', () => {
		sessionStorage.setItem('assinatura_reauth_id', ID);
		expect(lerReauthGuardado()).toBeNull();
		expect(sessionStorage.getItem('assinatura_reauth_id')).toBeNull();
	});

	it('id expirado some e o pad pede senha de novo', () => {
		gravarReauth(ID);
		vi.setSystemTime(new Date(Date.now() + REAUTH_VALIDADE_MS));
		expect(lerReauthGuardado()).toBeNull();
	});

	it('apagarReauth limpa o cache', () => {
		gravarReauth(ID);
		apagarReauth();
		expect(lerReauthGuardado()).toBeNull();
	});

	it('reconhece as frases do servidor mesmo com errorId no sufixo', () => {
		expect(ehErroReauthAssinatura(new Error(ERRO_REAUTH_AUSENTE))).toBe(true);
		expect(ehErroReauthAssinatura(new Error(`${ERRO_REAUTH_INVALIDA} (#ab12cd34)`))).toBe(true);
		expect(ehErroReauthAssinatura(new Error('Código inválido'))).toBe(false);
	});
});
