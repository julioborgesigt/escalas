/**
 * POST de form action do SvelteKit (body FormData).
 * Não use `apiFetch` aqui — actions esperam FormData + header de action.
 */
import { csrfHeaders } from '$lib/csrf';
import type { ActionResult } from '@sveltejs/kit';

export async function postFormAction(actionUrl: string, body: FormData): Promise<ActionResult> {
	const resp = await fetch(actionUrl, {
		method: 'POST',
		headers: {
			accept: 'application/json',
			'x-sveltekit-action': 'true',
			...csrfHeaders()
		},
		body
	});
	return (await resp.json()) as ActionResult;
}

/** Atalho para `?/nomeDaAction` na rota atual. */
export async function postPageAction(
	nome: string,
	body: FormData,
	pathname: string = typeof location !== 'undefined' ? location.pathname : ''
): Promise<ActionResult> {
	return postFormAction(`${pathname}?/${nome}`, body);
}
