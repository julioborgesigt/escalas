/**
 * A promise entregue ao `waitUntil` NUNCA rejeita.
 *
 * Rejeição crua no `waitUntil` vira exceção não tratada da invocação, atribuída
 * à requisição e não ao sync — e sem dizer QUAL escala ficou fora da planilha que
 * paga o extraordinário, que é a única pergunta que importa aqui
 * (FLW-WEBHOOK-003).
 *
 * Essa garantia existia, mas por ACIDENTE: cada `await` dentro de
 * `syncGiseBaseEquipeAposFinalizar` tem a sua própria guarda
 * (`executarSyncBaseEquipeGiseComResultado` devolve `{ok:false}`,
 * `registrarPendenciaBaseEquipe` e `auditar` nunca lançam,
 * `esquecerPendenciaBaseEquipe` e `atualizarGiseEscala` têm try/catch). Um
 * `await` novo sem guarda quebraria a propriedade em silêncio, e o `.catch` do
 * agendador morava só no ramo SEM `waitUntil` — o que NÃO roda em produção.
 *
 * Com o `.catch` antes do ramo, a garantia passa a ser estrutural. É este teste
 * que a prende: ele injeta um `db` que estoura em qualquer uso e exige que a
 * promise RESOLVA, com o `giseId` no log.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const erros: Array<{ msg: string; ctx?: Record<string, unknown> }> = [];

vi.mock('$lib/server/logger', () => ({
	logger: {
		error: (msg: string, ctx?: Record<string, unknown>) => erros.push({ msg, ctx }),
		warn: () => {},
		info: () => {},
		debug: () => {}
	}
}));

const { agendarSyncBaseEquipeAposFinalizar } = await import('../base-equipe-sync');

/** `db` que rejeita em qualquer uso — simula D1 fora do ar. */
const dbQuebrado = new Proxy(
	{},
	{
		get() {
			throw new Error('D1 indisponível');
		}
	}
) as never;

/** Env com URL+secret para o sync não sair pelo atalho de "desativado". */
const env = {
	GISE_BASE_EQUIPE_WEBHOOK_URL: 'https://script.google.com/macros/s/AKfy/exec',
	GISE_BASE_EQUIPE_SECRET: 'segredo'
};

beforeEach(() => {
	erros.length = 0;
});

describe('agendarSyncBaseEquipeAposFinalizar', () => {
	it('COM waitUntil: a promise entregue resolve mesmo com o banco quebrado', async () => {
		let entregue: Promise<unknown> | null = null;
		const platform = {
			env,
			ctx: {
				waitUntil: (p: Promise<unknown>) => {
					entregue = p;
				}
			}
		} as unknown as App.Platform;

		agendarSyncBaseEquipeAposFinalizar(platform, dbQuebrado, 4242);

		expect(entregue).not.toBeNull();
		// O ponto do teste: a promise entregue ao waitUntil NÃO rejeita, nem com o
		// banco estourando em toda chamada.
		await expect(entregue!).resolves.toBeUndefined();
		// E o diagnóstico nomeia a escala — sem isso, saber que falhou não ajuda.
		expect(erros.length).toBeGreaterThan(0);
		expect(erros.some((e) => e.ctx?.giseId === 4242)).toBe(true);
	});

	it('SEM waitUntil: mesmo tratamento e mesmo diagnóstico', async () => {
		const platform = { env } as unknown as App.Platform;
		agendarSyncBaseEquipeAposFinalizar(platform, dbQuebrado, 77);
		// Dá uma volta na fila de microtasks para o tratamento rodar.
		await new Promise((r) => setTimeout(r, 0));
		expect(erros.some((e) => e.ctx?.giseId === 77)).toBe(true);
	});

	it('a função não lança de forma síncrona — finalizar a escala não pode quebrar por causa do sync', () => {
		const platform = { env } as unknown as App.Platform;
		expect(() => agendarSyncBaseEquipeAposFinalizar(platform, dbQuebrado, 1)).not.toThrow();
	});
});
