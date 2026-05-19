import { csrfHeaders } from '$lib/csrf';

/**
 * Helper tipado para chamadas fetch JSON à API interna.
 * Injeta os headers CSRF, faz parse do JSON uma única vez e
 * lança um Error com a mensagem do servidor em caso de falha.
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
	if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
	return data as T;
}
