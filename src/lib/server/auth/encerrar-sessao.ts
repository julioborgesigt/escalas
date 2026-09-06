/**
 * Encerra a sessão do cookie atual — um lugar só para o POST `/api/auth/logout`
 * e para a action `sair` de `/alterar-senha`.
 *
 * Sem extração, as duas cópias divergiam no que o logout precisa fazer além de
 * apagar o cookie: invalidar o cache de borda (senão o token ainda vale até
 * 60s no colo) e gravar a auditoria. `/alterar-senha` é `ROTAS_SEM_SIDEBAR`,
 * então o primeiro acesso não tem o "Sair" do layout — a action da página é o
 * único caminho de UI, e tem de fazer a MESMA higiene.
 */

import type { RequestEvent } from '@sveltejs/kit';
import { getDB, auditar, contextoDeEvento } from '$lib/db';
import { excluirSessao } from '$lib/auth';
import { invalidarSessaoCache } from './session-cache';
import { CSRF_COOKIE_NAME } from './csrf';

/**
 * Apaga a sessão no D1 (se houver token), invalida o cache de borda, limpa os
 * cookies e zera `locals.usuario`. Idempotente: sem cookie, só limpa o CSRF.
 */
export async function encerrarSessaoAtual(event: RequestEvent): Promise<void> {
	const { platform, cookies, locals } = event;
	const token = cookies.get('session_token');
	if (token) {
		const db = getDB(platform);
		await excluirSessao(db, token);
		// Revogação imediata no colo local — sem isto o cache edge (TTL 60s)
		// ainda aceitaria o token por até 1 minuto após o logout.
		await invalidarSessaoCache(token);
		cookies.delete('session_token', { path: '/' });

		if (locals.usuario) {
			const { contexto, env } = contextoDeEvento(event);
			await auditar(
				db,
				{
					acao: 'logout',
					usuario: locals.usuario,
					entidade: locals.usuario.tipo,
					entidade_id: locals.usuario.id,
					detalhes: 'Logout',
					...contexto
				},
				{ env }
			);
		}
	}
	cookies.delete(CSRF_COOKIE_NAME, { path: '/' });
	locals.usuario = null;
}
