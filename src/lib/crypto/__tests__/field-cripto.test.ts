import { describe, it, expect } from 'vitest';
import { cifrarTexto, decifrarTexto, ehCifrado } from '../field-cripto';

const KEY = 'ab'.repeat(32); // 64 hex chars = 32 bytes

describe('field-cripto — round-trip AES-GCM', () => {
	it('cifra e decifra preservando o valor', async () => {
		const ip = '203.0.113.42';
		const enc = await cifrarTexto(ip, KEY);
		expect(enc.startsWith('enc:v1:')).toBe(true);
		expect(enc).not.toContain(ip);
		expect(await decifrarTexto(enc, KEY)).toBe(ip);
	});

	it('preserva IPv6 e textos unicode', async () => {
		const v = '2001:db8::dead:beef — São Paulo';
		expect(await decifrarTexto(await cifrarTexto(v, KEY), KEY)).toBe(v);
	});

	it('usa IV aleatório (cifras diferentes para o mesmo texto)', async () => {
		const a = await cifrarTexto('10.0.0.1', KEY);
		const b = await cifrarTexto('10.0.0.1', KEY);
		expect(a).not.toBe(b);
		expect(await decifrarTexto(a, KEY)).toBe(await decifrarTexto(b, KEY));
	});

	it('decifrarTexto devolve valores sem prefixo como estão (legado)', async () => {
		expect(await decifrarTexto('192.168.0.1', KEY)).toBe('192.168.0.1');
		expect(await decifrarTexto('', KEY)).toBe('');
		expect(await decifrarTexto(null, KEY)).toBe('');
	});

	it('ehCifrado detecta o envelope', () => {
		expect(ehCifrado('enc:v1:abc')).toBe(true);
		expect(ehCifrado('192.168.0.1')).toBe(false);
		expect(ehCifrado(null)).toBe(false);
	});

	it('rejeita chave de tamanho inválido', async () => {
		await expect(cifrarTexto('x', 'deadbeef')).rejects.toThrow();
	});
});
