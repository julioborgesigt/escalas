/**
 * O que os logs de e-mail podem conter — FLW-LGPD-002.
 *
 * O teste de `redigirEmails` prova que a função redige. Este prova o que o
 * achado realmente afirma: que **nenhum caminho** de `email.ts` deixa um
 * endereço chegar ao logger ou à mensagem de uma exceção que sobe.
 *
 * A diferença importa. O wrapper `enviarERegistrar` já mascarava o destinatário
 * antes desta correção, e mesmo assim o endereço vazava: vinha por dentro do
 * corpo de erro do provedor, embutido na mensagem do `Error`, e era registrado
 * como `err.message` pela mesma linha que aplicava a máscara. Cobertura no ponto
 * de log não é cobertura do caminho.
 *
 * Por isso a asserção é sempre a mesma e sempre negativa: varre TUDO que foi
 * logado — chaves e valores, em qualquer profundidade — procurando o endereço
 * em claro.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const DESTINATARIO = 'fulano.de.tal@delegacia.ce.gov.br';
const SEGUNDO = 'outro.policial@exemplo.org';

const registros: unknown[] = [];

vi.mock('$lib/server/logger', () => {
	const captura =
		() =>
		(...args: unknown[]) =>
			void registros.push(args);
	return { logger: { info: captura(), warn: captura(), error: captura(), debug: captura() } };
});

// Sem banco: `dispararEmail` cai no provedor padrão (cloudflare) em silêncio.
vi.mock('$lib/db', () => ({
	getDB: () => {
		throw new Error('sem banco no teste');
	}
}));

/** Tudo que foi logado, achatado em texto — inclusive chaves aninhadas. */
const tudoQueFoiLogado = () => JSON.stringify(registros);

// As duas chaves presentes de propósito: sem a do Resend, o fallback morre em
// "API key não configurada" antes de tocar a rede, e o caso dos DOIS provedores
// falhando nunca exercitaria o tratamento de erro do segundo.
const env = {
	CLOUDFLARE_API_TOKEN: 'token-de-teste',
	CLOUDFLARE_ACCOUNT_ID: 'conta-de-teste',
	RESEND_API_KEY: 're_chave-de-teste'
};
const platform = { env } as unknown as App.Platform;

beforeEach(() => {
	registros.length = 0;
});
afterEach(() => {
	vi.unstubAllGlobals();
});

async function enviar2FA() {
	const { enviarCodigo2FA } = await import('../email');
	return enviarCodigo2FA(DESTINATARIO, '123456', 'Fulano de Tal', platform);
}

describe('sucesso', () => {
	it('a lista de entregues NÃO vai para o log', async () => {
		// `result.delivered` é a lista de destinatários. Registrar a resposta
		// inteira jogava endereços em claro no Cloudflare Logs, fora do perímetro
		// de retenção do sistema.
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(
						JSON.stringify({ success: true, result: { delivered: [DESTINATARIO, SEGUNDO] } }),
						{ status: 200, headers: { 'Content-Type': 'application/json' } }
					)
			)
		);

		await enviar2FA();

		const logado = tudoQueFoiLogado();
		expect(logado).not.toContain(DESTINATARIO);
		expect(logado).not.toContain(SEGUNDO);
		// E ainda diz o que o operador precisa saber.
		expect(logado).toContain('entregues');
	});
});

describe('falha do provedor', () => {
	it('o corpo de erro é redigido no log E na mensagem que sobe', async () => {
		// O corpo de erro ecoa a requisição. Antes ia cru para o log e para o
		// `Error`, e a mensagem era registrada pelo wrapper — desfazendo, por
		// dentro, a máscara que o próprio wrapper aplicava no destinatário.
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(`{"errors":[{"message":"invalid recipient ${DESTINATARIO}"}]}`, {
						status: 422
					})
			)
		);

		await expect(enviar2FA()).rejects.toThrow();

		const logado = tudoQueFoiLogado();
		expect(logado, 'nenhum log pode conter o destinatário em claro').not.toContain(DESTINATARIO);
		// O motivo continua diagnosticável.
		expect(logado).toContain('invalid recipient');
	});

	it('com os DOIS provedores falhando, a exceção que sobe está limpa', async () => {
		// O fallback é o que torna este caso necessário: falhando só o Cloudflare,
		// o `Error` que chega ao chamador vem do Resend, e a asserção passaria com
		// o código furado. Quem captura pode registrar `err.message` por conta
		// própria — inclusive o Sentry —, então a mensagem tem de sair limpa da
		// ORIGEM, nos dois provedores.
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(`falhou para ${DESTINATARIO}`, { status: 500 }))
		);

		const erro = await enviar2FA().catch((e: unknown) => e);
		expect(String(erro), 'a mensagem do provedor de fallback também vaza').not.toContain(
			DESTINATARIO
		);
		expect(tudoQueFoiLogado()).not.toContain(DESTINATARIO);
	});
});
