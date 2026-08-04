import { describe, it, expect, vi, afterEach } from 'vitest';
import { apiFetch, apiFetchResponse } from '$lib/api-fetch';
import { digestHexParaBase64, executarFluxoAssinaturaToken } from '$lib/assinatura-token';

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' }
	});
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('apiFetch', () => {
	it('faz parse do JSON no sucesso', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => jsonResponse({ ok: true, valor: 42 }))
		);
		const data = await apiFetch<{ valor: number }>('/api/teste');
		expect(data.valor).toBe(42);
	});

	it('envia Content-Type application/json por padrão', async () => {
		const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({}));
		vi.stubGlobal('fetch', fetchMock);
		await apiFetch('/api/teste', { method: 'POST', body: '{}' });
		const init = fetchMock.mock.calls[0][1] as RequestInit;
		expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
	});

	it('lança Error com a mensagem do servidor em resposta não-ok', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => jsonResponse({ error: 'Escala não encontrada' }, 404))
		);
		await expect(apiFetch('/api/teste')).rejects.toThrow('Escala não encontrada');
	});

	it('concatena o errorId à mensagem quando presente', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => jsonResponse({ error: 'erro interno', errorId: 'abc12345' }, 500))
		);
		await expect(apiFetch('/api/teste')).rejects.toThrow('erro interno (#abc12345)');
	});

	it('usa fallback "HTTP <status>" quando o corpo de erro não é JSON', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('<html>erro</html>', { status: 502 }))
		);
		await expect(apiFetch('/api/teste')).rejects.toThrow('HTTP 502');
	});

	it('converte falha de rede em mensagem amigável', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				throw new TypeError('Failed to fetch');
			})
		);
		await expect(apiFetch('/api/teste')).rejects.toThrow('Erro de rede. Tente novamente.');
	});

	it('preserva AbortError para o chamador distinguir cancelamento', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				throw new DOMException('The operation was aborted.', 'AbortError');
			})
		);
		await expect(apiFetch('/api/teste')).rejects.toMatchObject({ name: 'AbortError' });
	});
});

describe('apiFetchResponse', () => {
	it('devolve a Response crua no sucesso (corpo não-JSON)', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('%PDF-1.7', { status: 200 }))
		);
		const res = await apiFetchResponse('/api/download');
		expect(await res.text()).toBe('%PDF-1.7');
	});

	it('extrai a mensagem de erro do corpo JSON em resposta não-ok', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => jsonResponse({ error: 'Sem permissão' }, 403))
		);
		await expect(apiFetchResponse('/api/download')).rejects.toThrow('Sem permissão');
	});
});

describe('digestHexParaBase64', () => {
	it('converte hex para o base64 dos bytes correspondentes', () => {
		// "Hello" em hex → btoa("Hello")
		expect(digestHexParaBase64('48656c6c6f')).toBe(btoa('Hello'));
	});
});

describe('executarFluxoAssinaturaToken', () => {
	it('encadeia preparar → assinar → finalizar repassando os campos do preparo', async () => {
		const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
			if (String(url).includes('preparar')) {
				return jsonResponse({
					intencao: 'int-abc',
					preparedPdf: 'PDFB64',
					messageDigest: '48656c6c6f',
					signingTimeISO: '2026-07-14T12:00:00Z',
					verificationHash: 'vhash',
					documentHash: 'dhash',
					assinanteEmail: 'a@b.c'
				});
			}
			return jsonResponse({ success: true });
		});
		vi.stubGlobal('fetch', fetchMock);

		const onFinalizando = vi.fn();
		const res = await executarFluxoAssinaturaToken({
			prepararUrl: '/api/x/preparar-assinatura',
			finalizarUrl: '/api/x/finalizar-assinatura',
			payloadPreparar: { signerName: 'Ana' },
			obterAssinatura: async (prep) => {
				expect(prep.messageDigest).toBe('48656c6c6f');
				return { serproCms: 'CMS' };
			},
			payloadFinalizar: { signerName: 'Ana', signerCpf: '123' },
			onFinalizando
		});

		expect(res.ok).toBe(true);
		expect(onFinalizando).toHaveBeenCalledOnce();
		expect(fetchMock).toHaveBeenCalledTimes(2);

		const finalizarInit = fetchMock.mock.calls[1][1] as RequestInit;
		const body = JSON.parse(String(finalizarInit.body));
		expect(body).toMatchObject({
			// A intenção do preparo VOLTA no finalizar — é o que amarra o PDF ao
			// documento, ao assinante e a um único uso (FLW-DOC-001).
			intencao: 'int-abc',
			preparedPdf: 'PDFB64',
			serproCms: 'CMS',
			messageDigest: '48656c6c6f',
			signingTimeISO: '2026-07-14T12:00:00Z',
			documentHash: 'dhash',
			assinanteEmail: 'a@b.c',
			signerName: 'Ana',
			signerCpf: '123'
		});
		// Não volta mais: era o cliente escolhendo a chave R2 e o código público.
		expect(body).not.toHaveProperty('verificationHash');
	});

	it('interrompe sem assinar quando o preparar falha', async () => {
		const fetchMock = vi.fn(async () => jsonResponse({ error: 'PDF indisponível' }, 409));
		vi.stubGlobal('fetch', fetchMock);
		const obterAssinatura = vi.fn();

		await expect(
			executarFluxoAssinaturaToken({
				prepararUrl: '/api/x/preparar-assinatura',
				finalizarUrl: '/api/x/finalizar-assinatura',
				payloadPreparar: {},
				obterAssinatura
			})
		).rejects.toThrow('PDF indisponível');
		expect(obterAssinatura).not.toHaveBeenCalled();
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
});
