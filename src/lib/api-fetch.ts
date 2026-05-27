import { csrfHeaders } from '$lib/csrf';

/**
 * Helper tipado para chamadas fetch JSON à API interna.
 * Injeta os headers CSRF, faz parse do JSON uma única vez e
 * lança um Error com a mensagem do servidor em caso de falha.
 *
 * Quando o body de erro inclui `errorId` (ver `serverError` em
 * `$lib/server/api.ts`), o ID é concatenado à mensagem — sem ele o usuário
 * lê "reporte o código de rastreamento" mas não vê código nenhum.
 */
export async function apiFetch<T = unknown>(
	url: string,
	init?: Omit<RequestInit, 'headers'> & { headers?: Record<string, string> }
): Promise<T> {
	const { headers: extraHeaders, ...rest } = init ?? {};
	const res = await fetch(url, {
		...rest,
		headers: {
			'Content-Type': 'application/json',
			...csrfHeaders(),
			...extraHeaders
		}
	});
	const data = await res.json();
	if (!res.ok) {
		const d = data as { error?: string; errorId?: string };
		const base = d.error ?? `HTTP ${res.status}`;
		const msg = d.errorId ? `${base} (#${d.errorId})` : base;
		throw new Error(msg);
	}
	return data as T;
}
