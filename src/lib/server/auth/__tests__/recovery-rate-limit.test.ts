/**
 * De ONDE o salt do rate-limit é lido — a pergunta que este teste prende.
 *
 * `chaveRateLimitIp` lia `RATE_LIMIT_IP_SALT` só de `process.env`, que no
 * Cloudflare Pages não é a fonte canônica (variável do painel chega por
 * `platform.env`, exposto pelo SvelteKit em `$env/dynamic/private`). O efeito
 * de errar a fonte é invisível: a chave degrada para o `/24` de `anonimizarIp`
 * e cinco falhas de login passam a bloquear a rede inteira — enquanto
 * `/api/health?detail=`, que confere a presença em `platform.env`, segue
 * reportando `ok`.
 *
 * Por isso os casos abaixo cobrem as DUAS fontes e a precedência entre elas:
 * é a divergência que o teste existe para impedir, não o formato da chave.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { envMock } = vi.hoisted(() => ({
	envMock: {} as Record<string, string | undefined>
}));
vi.mock('$env/dynamic/private', () => ({ env: envMock }));

import { chaveRateLimitIp } from '../recovery-rate-limit';

const IP = '203.0.113.42';
const SALT_ENV = 'salt-do-painel-cloudflare';
const SALT_PROCESS = 'salt-do-process-env';

describe('chaveRateLimitIp', () => {
	beforeEach(() => {
		delete envMock.RATE_LIMIT_IP_SALT;
		delete process.env.RATE_LIMIT_IP_SALT;
	});
	afterEach(() => {
		delete envMock.RATE_LIMIT_IP_SALT;
		delete process.env.RATE_LIMIT_IP_SALT;
	});

	it('sem salt em fonte nenhuma, cai no /24 (comportamento legado)', async () => {
		expect(await chaveRateLimitIp(IP)).toBe('203.0.113.0');
	});

	it('lê o salt de $env/dynamic/private — a fonte do Pages', async () => {
		envMock.RATE_LIMIT_IP_SALT = SALT_ENV;
		const chave = await chaveRateLimitIp(IP);
		expect(chave.startsWith('iph:')).toBe(true);
		expect(chave.slice(4)).toHaveLength(40);
	});

	it('mantém process.env como fallback (script/teste fora do worker)', async () => {
		process.env.RATE_LIMIT_IP_SALT = SALT_PROCESS;
		expect((await chaveRateLimitIp(IP)).startsWith('iph:')).toBe(true);
	});

	it('$env tem precedência sobre process.env', async () => {
		process.env.RATE_LIMIT_IP_SALT = SALT_PROCESS;
		const soProcess = await chaveRateLimitIp(IP);

		envMock.RATE_LIMIT_IP_SALT = SALT_ENV;
		const comEnv = await chaveRateLimitIp(IP);

		expect(comEnv).not.toBe(soProcess);
	});

	it('salt só de espaços não conta como salt', async () => {
		envMock.RATE_LIMIT_IP_SALT = '   ';
		expect(await chaveRateLimitIp(IP)).toBe('203.0.113.0');
	});

	it('IPs distintos da mesma /24 recebem chaves distintas COM salt', async () => {
		envMock.RATE_LIMIT_IP_SALT = SALT_ENV;
		const a = await chaveRateLimitIp('203.0.113.42');
		const b = await chaveRateLimitIp('203.0.113.43');
		expect(a).not.toBe(b);
	});

	it('IPs distintos da mesma /24 COLIDEM sem salt — o lockout que o salt evita', async () => {
		const a = await chaveRateLimitIp('203.0.113.42');
		const b = await chaveRateLimitIp('203.0.113.43');
		expect(a).toBe(b);
	});

	it('chave sintética não-IP passa intacta sem salt e é hasheada com salt', async () => {
		const sintetica = 'senha-atual:policial:42';
		expect(await chaveRateLimitIp(sintetica)).toBe(sintetica);

		envMock.RATE_LIMIT_IP_SALT = SALT_ENV;
		expect((await chaveRateLimitIp(sintetica)).startsWith('iph:')).toBe(true);
	});
});
