/**
 * DELETE /api/policiais/[id]/passkey — revogação administrativa da chave de
 * assinatura.
 *
 * O caminho de quem perdeu o celular. Existe porque a alternativa seria pior:
 * sem ele, o policial ficaria sem assinar até trocar de aparelho E conseguir
 * registrar sozinho — e a passkey antiga continuaria válida num aparelho que
 * já não está com ele.
 *
 * **É o teto da força probatória, e isso precisa estar escrito.** Quem contesta
 * uma assinatura vai apontar exatamente para cá: se um administrador revoga com
 * um clique e a pessoa registra outra chave, o "controle exclusivo" (Lei
 * 14.063/2020 art. 4º II "b") vale o que valer o controle sobre esta rota. Por
 * isso, três coisas:
 *
 *   1. **Só o Admin Geral** — não o admin de unidade;
 *   2. **auditado** com severidade `aviso`, para a revogação aparecer na
 *      trilha ao lado do registro seguinte;
 *   3. **revogar NÃO registra.** Cadastrar a chave nova é sempre do titular,
 *      no aparelho dele (`/api/webauthn/registro`). Um administrador que
 *      pudesse registrar pela pessoa esvaziaria a prova inteira.
 *
 * Documentos já assinados não são afetados: a credencial revogada continua na
 * tabela (`revogado_em`), consultável para conferir aquelas assinaturas.
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { eq } from 'drizzle-orm';
import { getDB, revogarCredenciaisAtivas, registrarAuditComContexto } from '$lib/db';
import { policiais } from '$lib/server/schema';
import { requireAdmin, badRequest, notFound } from '$lib/server/api';
import { resolverCredencial } from '$lib/server/auth/credencial';

export const DELETE: RequestHandler = async ({ locals, platform, params }) => {
	const u = requireAdmin(locals);
	if (u instanceof Response) return u;

	const id = parseInt(params.id ?? '', 10);
	if (Number.isNaN(id) || id < 1) return badRequest('ID inválido');

	const db = getDB(platform);
	const alvo = await db
		.select({ id: policiais.id, nome: policiais.nome })
		.from(policiais)
		.where(eq(policiais.id, id))
		.get();
	if (!alvo) return notFound('Policial');

	// A credencial pertence à PESSOA: quem é Admin Geral vinculado tem linha em
	// `policiais` e em `administradores`, e revogar pelo par cru deixaria a
	// credencial viva no outro modo.
	const credencial = await resolverCredencial(db, 'policial', id);
	const quantas = await revogarCredenciaisAtivas(db, credencial.dono);

	if (quantas > 0) {
		await registrarAuditComContexto(db, {
			usuario: u,
			acao: 'passkey_revogada',
			entidade: 'policial',
			entidade_id: id,
			detalhes: `Passkey de ${alvo.nome} revogada pela administração`
		});
	}

	return json({ success: true, revogadas: quantas });
};
