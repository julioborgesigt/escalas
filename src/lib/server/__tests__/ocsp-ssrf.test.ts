import { describe, it, expect } from 'vitest';
import { urlOcspPermitida } from '../ocsp';

describe('urlOcspPermitida (guard SSRF do OCSP)', () => {
	it('aceita responder OCSP público (http e https)', () => {
		expect(urlOcspPermitida('http://ocsp.acme.example/')).toBe(true);
		expect(urlOcspPermitida('https://ocsp.icpbrasil.gov.br/path')).toBe(true);
		expect(urlOcspPermitida('http://8.8.8.8/')).toBe(true);
	});

	it('rejeita esquemas não-http', () => {
		expect(urlOcspPermitida('file:///etc/passwd')).toBe(false);
		expect(urlOcspPermitida('gopher://x/')).toBe(false);
		expect(urlOcspPermitida('ftp://host/')).toBe(false);
	});

	it('rejeita localhost e nomes locais', () => {
		expect(urlOcspPermitida('http://localhost/')).toBe(false);
		expect(urlOcspPermitida('http://foo.localhost/')).toBe(false);
		expect(urlOcspPermitida('http://svc.internal/')).toBe(false);
		expect(urlOcspPermitida('http://printer.local/')).toBe(false);
	});

	it('rejeita loopback e redes privadas IPv4', () => {
		expect(urlOcspPermitida('http://127.0.0.1/')).toBe(false);
		expect(urlOcspPermitida('http://10.0.0.5/')).toBe(false);
		expect(urlOcspPermitida('http://172.16.0.1/')).toBe(false);
		expect(urlOcspPermitida('http://172.31.255.1/')).toBe(false);
		expect(urlOcspPermitida('http://192.168.1.1/')).toBe(false);
		expect(urlOcspPermitida('http://100.64.0.1/')).toBe(false);
		expect(urlOcspPermitida('http://0.0.0.0/')).toBe(false);
	});

	it('rejeita o endpoint de metadados de nuvem (169.254.169.254)', () => {
		expect(urlOcspPermitida('http://169.254.169.254/latest/meta-data/')).toBe(false);
	});

	it('aceita IPv4 público fora das faixas privadas', () => {
		expect(urlOcspPermitida('http://172.15.0.1/')).toBe(true); // < 172.16/12
		expect(urlOcspPermitida('http://172.32.0.1/')).toBe(true); // > 172.16/12
		expect(urlOcspPermitida('http://1.1.1.1/')).toBe(true);
	});

	it('rejeita loopback/link-local/ULA IPv6', () => {
		expect(urlOcspPermitida('http://[::1]/')).toBe(false);
		expect(urlOcspPermitida('http://[fe80::1]/')).toBe(false);
		expect(urlOcspPermitida('http://[fc00::1]/')).toBe(false);
		expect(urlOcspPermitida('http://[fd12:3456::1]/')).toBe(false);
	});

	it('rejeita URL malformada ou vazia', () => {
		expect(urlOcspPermitida('not a url')).toBe(false);
		expect(urlOcspPermitida('')).toBe(false);
	});
});
