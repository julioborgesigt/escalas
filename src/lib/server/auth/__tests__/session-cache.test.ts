/**
 * A janela do cache de sessão — FLW-AUTH-001.
 *
 * O achado é que uma sessão revogada continua valendo por até um TTL, e o Cache
 * API do Cloudflare é POR COLO: quem usa o token em outro data center tem a
 * janela inteira, mesmo depois de um logout que invalidou a entrada local. Não
 * dá para fechar isso sem desligar o cache; o que dá é estreitar a garantia até
 * ela ficar defensável — **leitura pode atrasar, ação não** — e fixar a decisão
 * que a produz.
 *
 * Este teste é de unidade e não de ponta a ponta por um motivo concreto: o
 * Cache API não funciona no preview local, então um spec Playwright passaria
 * com a regra ligada E desligada. Teste que não distingue os dois casos é pior
 * que teste nenhum, porque parece cobertura.
 */
import { describe, it, expect } from 'vitest';
import { resolverTtlCacheSessao, ttlCacheSessaoParaMetodo } from '../session-cache';

const comEnv = (valor?: string) =>
	({ env: valor === undefined ? {} : { SESSION_CACHE_TTL_SECONDS: valor } }) as App.Platform;

describe('resolverTtlCacheSessao', () => {
	it('sem configuração, 60s', () => {
		expect(resolverTtlCacheSessao(comEnv())).toBe(60);
		expect(resolverTtlCacheSessao(undefined)).toBe(60);
	});

	it('respeita o valor configurado e o teto de 300s', () => {
		expect(resolverTtlCacheSessao(comEnv('10'))).toBe(10);
		expect(resolverTtlCacheSessao(comEnv('9999'))).toBe(300);
	});

	it('valor inválido cai no default em vez de desligar o cache por engano', () => {
		expect(resolverTtlCacheSessao(comEnv('abc'))).toBe(60);
		expect(resolverTtlCacheSessao(comEnv(''))).toBe(60);
	});

	it('zero desliga — é o botão de revogação imediata', () => {
		expect(resolverTtlCacheSessao(comEnv('0'))).toBe(0);
		expect(resolverTtlCacheSessao(comEnv('-5'))).toBe(0);
	});
});

describe('ttlCacheSessaoParaMetodo — quem MUTA não usa o cache', () => {
	it.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
		'%s revalida no D1 mesmo com o cache ligado',
		(metodo) => {
			expect(ttlCacheSessaoParaMetodo(comEnv('60'), metodo)).toBe(0);
		}
	);

	it.each(['GET', 'HEAD', 'OPTIONS'])('%s continua servido do cache', (metodo) => {
		expect(ttlCacheSessaoParaMetodo(comEnv('60'), metodo)).toBe(60);
	});

	it('método em minúsculas também conta como mutação', () => {
		// O `event.request.method` chega normalizado, mas depender disso deixaria a
		// garantia por conta de um detalhe de quem chama.
		expect(ttlCacheSessaoParaMetodo(comEnv('60'), 'post')).toBe(0);
	});

	it('desligar o cache não é revertido pelo método de leitura', () => {
		expect(ttlCacheSessaoParaMetodo(comEnv('0'), 'GET')).toBe(0);
	});
});
