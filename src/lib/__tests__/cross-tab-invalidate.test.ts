/**
 * Sincronização entre abas do mesmo navegador (BroadcastChannel).
 *
 * Dois riscos justificam estes testes:
 *
 * 1. **Eco.** Quem publica não pode reagir à própria mensagem — o
 *    BroadcastChannel não entrega ao emissor, mas isso é fácil de quebrar
 *    trocando por `localStorage`/`postMessage`, e o sintoma seria um laço de
 *    invalidação difícil de rastrear.
 * 2. **Degradação.** Em navegador sem `BroadcastChannel` (ou com ele
 *    bloqueado), nada pode explodir: o poll de `useInvalidateOnFocus` já cobre
 *    o caso e a aba só perde a sincronia instantânea.
 *
 * O `$app/environment` é mockado como browser porque o vitest roda em `node` e
 * o módulo desliga o canal fora do navegador.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const invalidate = vi.fn(async (_chave: string) => {});
const invalidateAll = vi.fn(async () => {});

vi.mock('$app/environment', () => ({ browser: true }));
vi.mock('$app/navigation', () => ({
	invalidate: (c: string) => invalidate(c),
	invalidateAll: () => invalidateAll()
}));

const { invalidateShared, invalidateAllShared, subscribeInvalidate } =
	await import('../cross-tab-invalidate');

/** Simula a OUTRA aba: mesmo canal, processo separado do módulo sob teste. */
function outraAba() {
	return new BroadcastChannel('escalas:invalidate');
}

/** BroadcastChannel entrega de forma assíncrona. */
const entregar = () => new Promise((r) => setTimeout(r, 10));

beforeEach(() => {
	invalidate.mockClear();
	invalidateAll.mockClear();
});

describe('invalidateShared', () => {
	it('invalida localmente cada chave', async () => {
		await invalidateShared('app:recebidos', 'app:painel');
		expect(invalidate.mock.calls.map((c) => c[0])).toEqual(['app:recebidos', 'app:painel']);
	});

	it('sem chaves, não faz nada', async () => {
		await invalidateShared();
		expect(invalidate).not.toHaveBeenCalled();
	});

	it('notifica as outras abas com as chaves', async () => {
		const ch = outraAba();
		const recebidas: unknown[] = [];
		ch.onmessage = (ev) => recebidas.push(ev.data);

		await invalidateShared('gise:detail');
		await entregar();

		expect(recebidas).toEqual([{ chaves: ['gise:detail'] }]);
		ch.close();
	});

	it('`invalidateAllShared` publica o coringa', async () => {
		const ch = outraAba();
		const recebidas: unknown[] = [];
		ch.onmessage = (ev) => recebidas.push(ev.data);

		await invalidateAllShared();
		await entregar();

		expect(invalidateAll).toHaveBeenCalledOnce();
		expect(recebidas).toEqual([{ chaves: ['*'] }]);
		ch.close();
	});
});

describe('subscribeInvalidate', () => {
	let ch: BroadcastChannel;
	beforeEach(() => (ch = outraAba()));
	afterEach(() => ch.close());

	it('dispara quando a chave de interesse é publicada', async () => {
		const onMatch = vi.fn();
		const cancelar = subscribeInvalidate('app:recebidos', onMatch);

		ch.postMessage({ chaves: ['app:recebidos'] });
		await entregar();

		expect(onMatch).toHaveBeenCalledOnce();
		cancelar();
	});

	it('ignora chave de outro interesse', async () => {
		const onMatch = vi.fn();
		const cancelar = subscribeInvalidate('app:recebidos', onMatch);

		ch.postMessage({ chaves: ['gise:detail'] });
		await entregar();

		expect(onMatch).not.toHaveBeenCalled();
		cancelar();
	});

	it('o coringa `*` casa com qualquer interesse', async () => {
		const onMatch = vi.fn();
		const cancelar = subscribeInvalidate('qualquer-coisa', onMatch);

		ch.postMessage({ chaves: ['*'] });
		await entregar();

		expect(onMatch).toHaveBeenCalledOnce();
		cancelar();
	});

	it('mensagem malformada não derruba o listener', async () => {
		const onMatch = vi.fn();
		const cancelar = subscribeInvalidate('app:recebidos', onMatch);

		for (const lixo of [null, 'texto', { chaves: 'nao-array' }, {}, 42]) {
			ch.postMessage(lixo);
		}
		await entregar();

		expect(onMatch).not.toHaveBeenCalled();
		// E o canal continua vivo depois do lixo.
		ch.postMessage({ chaves: ['app:recebidos'] });
		await entregar();
		expect(onMatch).toHaveBeenCalledOnce();
		cancelar();
	});

	it('cancelar remove o listener de verdade', async () => {
		const onMatch = vi.fn();
		subscribeInvalidate('app:recebidos', onMatch)();

		ch.postMessage({ chaves: ['app:recebidos'] });
		await entregar();

		expect(onMatch).not.toHaveBeenCalled();
	});

	it('quem publica NÃO reage à própria mensagem (sem eco)', async () => {
		const onMatch = vi.fn();
		const cancelar = subscribeInvalidate('app:painel', onMatch);

		await invalidateShared('app:painel');
		await entregar();

		// `invalidate` local rodou uma vez; o listener da MESMA aba não pode
		// disparar de novo, senão vira laço.
		expect(invalidate).toHaveBeenCalledOnce();
		expect(onMatch).not.toHaveBeenCalled();
		cancelar();
	});
});

describe('sem BroadcastChannel no navegador', () => {
	const original = globalThis.BroadcastChannel;
	afterEach(() => {
		globalThis.BroadcastChannel = original;
		vi.resetModules();
	});

	it('degrada em silêncio: invalida local e não lança', async () => {
		// @ts-expect-error — simulando ambiente sem a API.
		delete globalThis.BroadcastChannel;
		vi.resetModules();
		const mod = await import('../cross-tab-invalidate');

		await expect(mod.invalidateShared('app:painel')).resolves.toBeUndefined();
		expect(mod.subscribeInvalidate('app:painel', vi.fn())).toBeTypeOf('function');
		// O cancelamento devolvido também precisa ser chamável.
		expect(() => mod.subscribeInvalidate('app:painel', vi.fn())()).not.toThrow();
	});
});
