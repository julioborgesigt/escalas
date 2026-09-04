/**
 * Provedor de e-mail pendurado tem de FALHAR, não esperar.
 *
 * `ocsp.ts` (10 s) e `tsa.ts` (15 s) já usavam AbortController; `email.ts` não
 * tinha teto nenhum. E envio de e-mail não é caminho secundário aqui:
 * `enviarCodigo2FA` está no caminho crítico do login — relança de propósito,
 * porque sem o código ninguém entra — e `/api/auth/solicitar-redefinicao` é rota
 * PÚBLICA. Por essas duas portas, provedor lento viraria indisponibilidade do
 * login, com o limite da plataforma como única defesa.
 *
 * O teste usa timers falsos: sem eles seriam 15 s de espera real por caso.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('$lib/server/logger', () => ({
	logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }
}));
vi.mock('$lib/db', () => ({
	getDB: () => {
		throw new Error('sem banco no teste');
	}
}));

const env = {
	CLOUDFLARE_API_TOKEN: 'token-de-teste',
	CLOUDFLARE_ACCOUNT_ID: 'conta-de-teste',
	RESEND_API_KEY: 're_chave-de-teste'
};
const platform = { env } as unknown as App.Platform;

beforeEach(() => {
	vi.useFakeTimers();
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

/** Provedor que nunca responde — só reage ao abort do `signal`. */
function fetchQuePendura() {
	return vi.fn(
		(_url: string, init?: RequestInit) =>
			new Promise<Response>((_resolve, reject) => {
				init?.signal?.addEventListener('abort', () =>
					reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }))
				);
			})
	);
}

describe('envio de e-mail com provedor pendurado', () => {
	it('aborta em vez de esperar indefinidamente', async () => {
		const espiao = fetchQuePendura();
		vi.stubGlobal('fetch', espiao);

		const { enviarCodigo2FA } = await import('../email');
		const promessa = enviarCodigo2FA('a@b.com', '123456', 'Fulano', platform).catch(
			(e: unknown) => e
		);

		// Antes do teto: ninguém abortou ainda.
		await vi.advanceTimersByTimeAsync(14_000);
		expect(espiao.mock.calls.length).toBeGreaterThan(0);

		// Passado o teto, os DOIS provedores abortam e o envio termina rejeitando —
		// que é o contrato de `enviarCodigo2FA` (relança para o login saber).
		await vi.advanceTimersByTimeAsync(20_000);
		const resultado = await promessa;
		expect(resultado).toBeInstanceOf(Error);
	});

	it('todo `fetch` de e-mail recebe um AbortSignal', async () => {
		const espiao = fetchQuePendura();
		vi.stubGlobal('fetch', espiao);

		const { enviarCodigo2FA } = await import('../email');
		const promessa = enviarCodigo2FA('a@b.com', '123456', 'Fulano', platform).catch(() => null);
		await vi.advanceTimersByTimeAsync(40_000);
		await promessa;

		expect(espiao.mock.calls.length).toBeGreaterThan(0);
		for (const [, init] of espiao.mock.calls) {
			expect((init as RequestInit | undefined)?.signal, 'fetch sem signal').toBeDefined();
		}
	});
});
