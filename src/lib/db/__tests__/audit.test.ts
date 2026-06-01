import { describe, it, expect } from 'vitest';
import { anonimizarIp } from '../audit';

describe('anonimizarIp — IPv4', () => {
	it('zera último octeto (/24)', () => {
		expect(anonimizarIp('192.168.1.42')).toBe('192.168.1.0');
		expect(anonimizarIp('10.0.0.255')).toBe('10.0.0.0');
	});

	it('aceita IPs com octetos no extremo', () => {
		expect(anonimizarIp('255.255.255.255')).toBe('255.255.255.0');
		expect(anonimizarIp('0.0.0.0')).toBe('0.0.0.0');
	});

	it('rejeita IPv4 malformado', () => {
		expect(anonimizarIp('1.2.3')).toBeNull();
		expect(anonimizarIp('not-an-ip')).toBeNull();
	});
});

describe('anonimizarIp — IPv6 /64 (I-3)', () => {
	it('zera 4 últimos grupos em endereço completo', () => {
		expect(anonimizarIp('2001:0db8:0000:0000:1234:5678:9abc:def0')).toBe('2001:0db8:0000:0000::');
	});

	it('expande notação `::` e preserva /64', () => {
		// 2001:db8::1 == 2001:0db8:0000:0000:0000:0000:0000:0001
		// /64 prefix == 2001:0db8:0000:0000 == 2001:db8::
		expect(anonimizarIp('2001:db8::1')).toBe('2001:db8:0:0::');
	});

	it('expande `::` no meio', () => {
		// fe80::1:2 == fe80:0000:0000:0000:0000:0000:0001:0002
		// primeiros 4 grupos == fe80:0:0:0
		expect(anonimizarIp('fe80::1:2')).toBe('fe80:0:0:0::');
	});

	it('expande `::` no início', () => {
		// ::1 == 0:0:0:0:0:0:0:1 → /64 == 0:0:0:0::
		expect(anonimizarIp('::1')).toBe('0:0:0:0::');
	});

	it('expande `::` no fim', () => {
		// 2001:db8:1:: == 2001:db8:1:0:0:0:0:0 → /64 == 2001:db8:1:0::
		expect(anonimizarIp('2001:db8:1::')).toBe('2001:db8:1:0::');
	});

	it('rejeita IPv6 com mais de 8 grupos', () => {
		expect(anonimizarIp('a:b:c:d:e:f:1:2:3')).toBeNull();
	});

	it('NÃO preserva nada além de /64 (regressão M-3 do audit)', () => {
		// Garante que conteúdo do 5º grupo em diante sumiu — atacante não
		// consegue distinguir subscribers do mesmo /64.
		const out = anonimizarIp('2001:db8:1234:5678:aaaa:bbbb:cccc:dddd');
		expect(out).toBe('2001:db8:1234:5678::');
		expect(out).not.toContain('aaaa');
		expect(out).not.toContain('bbbb');
	});
});

describe('anonimizarIp — bordas', () => {
	it('retorna null para vazio/undefined', () => {
		expect(anonimizarIp(null)).toBeNull();
		expect(anonimizarIp(undefined)).toBeNull();
		expect(anonimizarIp('')).toBeNull();
	});
});
