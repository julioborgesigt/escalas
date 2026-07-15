import { csrfHeaders } from '$lib/csrf';

/**
 * Helpers padrão para chamadas à API interna a partir do cliente.
 *
 * Use `apiFetch` para APIs JSON e `apiFetchResponse` para downloads/blob.
 * `fetch` cru só se justifica quando o chamador precisa de semântica que os
 * helpers não cobrem: POST de form action do SvelteKit (body FormData).
 */
type ApiFetchInit = Omit<RequestInit, 'headers'> & { headers?: Record<string, string> };

/**
 * Camada base do fetch à API interna: injeta os headers CSRF, converte
 * falha de rede em mensagem amigável e, em resposta não-ok, lança um Error
 * com a mensagem do servidor — devolvendo a Response crua no sucesso.
 *
 * Use esta variante quando o corpo de sucesso NÃO é JSON (download de PDF,
 * blob); para APIs JSON use `apiFetch`.
 *
 * Quando o body de erro inclui `errorId` (ver `serverError` em
 * `$lib/server/api.ts`), o ID é concatenado à mensagem — sem ele o usuário
 * lê "reporte o código de rastreamento" mas não vê código nenhum.
 */
export async function apiFetchResponse(url: string, init?: ApiFetchInit): Promise<Response> {
	const { headers: extraHeaders, ...rest } = init ?? {};
	let res: Response;
	try {
		res = await fetch(url, {
			...rest,
			headers: {
				'Content-Type': 'application/json',
				...csrfHeaders(),
				...extraHeaders
			}
		});
	} catch (err) {
		// Aborto explícito (AbortSignal) não é falha de rede — preserva a
		// exceção para o chamador distinguir cancelamento de erro real.
		if (err instanceof DOMException && err.name === 'AbortError') throw err;
		// Fora isso, fetch() só rejeita por falha de rede/CORS, nunca por
		// status HTTP — mensagem amigável em vez de vazar "Failed to fetch".
		throw new Error('Erro de rede. Tente novamente.', { cause: err });
	}
	if (!res.ok) {
		// Erros podem chegar sem corpo JSON (ex.: página de erro do
		// Cloudflare); nesse caso o fallback "HTTP <status>" assume, em vez
		// de estourar SyntaxError com mensagem críptica.
		const d = ((await res.json().catch(() => null)) ?? {}) as {
			error?: string;
			errorId?: string;
		};
		const base = d.error ?? `HTTP ${res.status}`;
		throw new Error(d.errorId ? `${base} (#${d.errorId})` : base);
	}
	return res;
}

/**
 * Helper tipado para chamadas fetch JSON à API interna.
 * Injeta os headers CSRF, faz parse do JSON uma única vez e
 * lança um Error com a mensagem do servidor em caso de falha.
 */
export async function apiFetch<T = unknown>(url: string, init?: ApiFetchInit): Promise<T> {
	const res = await apiFetchResponse(url, init);
	// Toda API interna responde JSON no sucesso; o catch é só cinto de
	// segurança para não vazar SyntaxError caso isso um dia mude.
	return (await res.json().catch(() => null)) as T;
}
