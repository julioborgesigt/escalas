/**
 * `memoEdge` — o laço ler→calcular→gravar que os caches de edge repetiam à mão.
 *
 * O contrato tem três metades, e as duas últimas são as que impedem que o cache
 * derrube o que ele deveria só acelerar:
 *
 *  - com `caches` presente, o segundo acesso NÃO recalcula;
 *  - sem `caches` (é o caso de CI, vitest e do preview local), cai no cálculo
 *    direto em silêncio — cache aqui é otimização, e ausência dele não pode ser
 *    erro;
 *  - `ttlSeconds <= 0` desliga, que é o botão de "quero o valor vivo".
 *
 * O ambiente do vitest é `node`, sem Cache API, então a `caches` de teste é
 * montada aqui. Ela guarda o CORPO e devolve uma `Response` nova a cada
 * `match`: uma `Response` só pode ser lida uma vez, e um duble que devolvesse
 * sempre a mesma instância passaria no primeiro acerto e falharia no segundo —
 * por um motivo que não é o do código sob teste.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { chaveEdge, memoEdge } from '../edge-cache';

/**
 * O escopo global visto de forma SOLTA, e não como `typeof globalThis`.
 *
 * Ali `caches` é a `CacheStorage` dos `@cloudflare/workers-types`: obrigatória
 * (o `delete` do `beforeEach` não compila) e com `open`/`keys`/`has`/`delete`
 * que este duble não implementa — nem precisa, porque `edge-cache` só chama
 * `match` e `put`. Implementá-las por causa do tipo seria escrever código morto
 * para o compilador ficar quieto.
 */
type EscopoComCaches = { caches?: unknown };
const escopo = globalThis as unknown as EscopoComCaches;

/** Cache API mínima, em memória, chaveada pela URL da `Request`. */
function cacheFalso() {
	const corpos = new Map<string, string>();
	return {
		guardados: corpos,
		default: {
			async match(req: Request) {
				const corpo = corpos.get(req.url);
				return corpo === undefined ? undefined : new Response(corpo);
			},
			async put(req: Request, res: Response) {
				corpos.set(req.url, await res.text());
			}
		}
	};
}

const original = escopo.caches;

beforeEach(() => {
	delete escopo.caches;
});

afterEach(() => {
	if (original === undefined) delete escopo.caches;
	else escopo.caches = original;
});

describe('memoEdge', () => {
	it('calcula uma vez e serve a segunda do cache', async () => {
		escopo.caches = cacheFalso();
		const calcular = vi.fn(async () => ({ n: 7 }));
		const chave = chaveEdge('teste-memo/v1/a');

		expect(await memoEdge(chave, 15, calcular)).toEqual({ n: 7 });
		expect(await memoEdge(chave, 15, calcular)).toEqual({ n: 7 });

		expect(calcular).toHaveBeenCalledTimes(1);
	});

	it('chaves diferentes não se misturam', async () => {
		escopo.caches = cacheFalso();

		const a = await memoEdge(chaveEdge('teste-memo/v1/a'), 15, async () => 'valor-a');
		const b = await memoEdge(chaveEdge('teste-memo/v1/b'), 15, async () => 'valor-b');

		expect(a).toBe('valor-a');
		expect(b).toBe('valor-b');
	});

	it('sem `caches` no ambiente, calcula sempre e não lança', async () => {
		const calcular = vi.fn(async () => 'sem-cache');
		const chave = chaveEdge('teste-memo/v1/c');

		expect(await memoEdge(chave, 15, calcular)).toBe('sem-cache');
		expect(await memoEdge(chave, 15, calcular)).toBe('sem-cache');

		expect(calcular).toHaveBeenCalledTimes(2);
	});

	it('TTL zero desliga o cache — nem lê nem grava', async () => {
		const falso = cacheFalso();
		escopo.caches = falso;
		const calcular = vi.fn(async () => 'vivo');
		const chave = chaveEdge('teste-memo/v1/d');

		expect(await memoEdge(chave, 0, calcular)).toBe('vivo');
		expect(await memoEdge(chave, 0, calcular)).toBe('vivo');

		expect(calcular).toHaveBeenCalledTimes(2);
		expect(falso.guardados.size).toBe(0);
	});

	it('falha do cache não propaga — cai no cálculo', async () => {
		escopo.caches = {
			default: {
				match: async () => {
					throw new Error('colo indisponível');
				},
				put: async () => {
					throw new Error('put recusado');
				}
			}
		};

		await expect(memoEdge(chaveEdge('teste-memo/v1/e'), 15, async () => 'ok')).resolves.toBe('ok');
	});
});
