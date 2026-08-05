/**
 * ONDE mora a senha de um usuário, e QUAIS sessões ela destrava.
 *
 * O Admin Geral VINCULADO é uma pessoa com DUAS linhas: uma em `policiais` e
 * uma em `administradores` com `policial_id` apontando para ela. A linha admin
 * não tem senha própria — recebe um placeholder aleatório em
 * `vincularAdminGeral` e nunca o usa. O login de administrador autentica
 * contra `policiais.senha` (`auth-flow.ts`), a mesma senha do modo usuário.
 *
 * Disso saem duas perguntas que TODO fluxo de credencial precisa responder, e
 * que são fáceis de responder pela metade:
 *
 *   1. **Onde gravar a senha nova?** Na linha que o login lê. Gravar na linha
 *      admin de um vinculado não muda nada: a senha nova não passa a valer e a
 *      antiga continua valendo. Era o que `redefinir-senha` fazia até
 *      ago/2026 (FLW-AUTH-002) — um reset que falha em silêncio, e falha
 *      justamente quando alguém está tentando trocar uma senha comprometida.
 *   2. **Quais sessões derrubar?** As das DUAS identidades. Uma senha,
 *      dois cookies possíveis: derrubar só o do modo em que a pessoa estava
 *      deixa o outro vivo, e é por ele que um cookie roubado sobrevive à
 *      troca de senha que existia para matá-lo.
 *
 * A pergunta (1) já estava respondida — corretamente e com comentário — em
 * `alterar-senha/+page.server.ts` e em `email-pessoal-guard.ts`. Não protegeu
 * `redefinir-senha`, que nasceu sem ela. Comentário protege quem lê AQUELE
 * arquivo; a extração protege quem não sabe que ele existe.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { administradores, sessoes } from '../schema';
import type { Database } from '$lib/db';

export type TipoIdentidade = 'policial' | 'admin';

export interface Identidade {
	tipo: TipoIdentidade;
	id: number;
}

export interface Credencial {
	/** Linha que o login LÊ — é onde a senha nova deve ser gravada. */
	dono: Identidade;
	/** Toda identidade que esta senha destrava: uma, ou duas se vinculado. */
	identidades: Identidade[];
	/** `true` quando policial e admin são a mesma pessoa. */
	vinculado: boolean;
}

/**
 * Resolve a credencial a partir de um par `(tipo, id)` CRU — o que os fluxos
 * sem sessão têm em mãos (link de redefinição, webhook, desativação).
 *
 * Quem já tem `locals.usuario` pode usar `credencialDoUsuario`, que não
 * consulta o banco.
 */
export async function resolverCredencial(
	db: Database,
	tipo: TipoIdentidade,
	id: number
): Promise<Credencial> {
	if (tipo === 'policial') {
		const admin = await db
			.select({ id: administradores.id })
			.from(administradores)
			.where(eq(administradores.policial_id, id))
			.get();
		const eu: Identidade = { tipo: 'policial', id };
		return admin
			? { dono: eu, identidades: [eu, { tipo: 'admin', id: admin.id }], vinculado: true }
			: { dono: eu, identidades: [eu], vinculado: false };
	}

	const admin = await db
		.select({ policial_id: administradores.policial_id })
		.from(administradores)
		.where(eq(administradores.id, id))
		.get();

	const eu: Identidade = { tipo: 'admin', id };
	// Sem linha admin, ou admin STANDALONE (bootstrap por env): a senha é a dele.
	if (!admin || admin.policial_id == null) {
		return { dono: eu, identidades: [eu], vinculado: false };
	}
	const policial: Identidade = { tipo: 'policial', id: admin.policial_id };
	return { dono: policial, identidades: [eu, policial], vinculado: true };
}

/**
 * Mesma resposta, sem ida ao banco, para quem já tem a sessão resolvida —
 * `adminPolicialId` é preenchido em `validarSessao`.
 *
 * Só serve para o usuário LOGADO. Um policial que tem conta admin vinculada,
 * logado no modo usuário, não carrega o id da linha admin na sessão: neste
 * sentido a resposta é parcial, e por isso quem vai REVOGAR sessões deve usar
 * `resolverCredencial`, que enxerga os dois lados.
 */
export function credencialDoUsuario(u: {
	tipo: TipoIdentidade;
	id: number;
	adminPolicialId?: number | null;
}): Identidade {
	return u.adminPolicialId != null
		? { tipo: 'policial', id: u.adminPolicialId }
		: { tipo: u.tipo, id: u.id };
}

/**
 * Derruba as sessões de TODAS as identidades da credencial.
 *
 * Chamar depois de trocar/redefinir a senha e ao desativar a pessoa.
 *
 * Um `DELETE` por tipo, porque `(tipo, usuario_id)` só identifica a sessão em
 * par: `policiais.id = 21` e `administradores.id = 21` são pessoas diferentes,
 * e um `IN` sobre os ids sem separar o tipo derrubaria a sessão de um terceiro.
 */
export async function revogarSessoesDaCredencial(db: Database, cred: Credencial): Promise<void> {
	const porTipo = (tipo: TipoIdentidade) =>
		cred.identidades.filter((i) => i.tipo === tipo).map((i) => i.id);

	const policiais = porTipo('policial');
	const admins = porTipo('admin');

	if (policiais.length) {
		await db
			.delete(sessoes)
			.where(and(eq(sessoes.tipo, 'policial'), inArray(sessoes.usuario_id, policiais)));
	}
	if (admins.length) {
		await db
			.delete(sessoes)
			.where(and(eq(sessoes.tipo, 'admin'), inArray(sessoes.usuario_id, admins)));
	}
}
