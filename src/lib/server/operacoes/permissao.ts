/**
 * Quem pode escrever a linha de base de qual unidade.
 *
 * A regra de negócio, em uma frase: **o admin informa a base das unidades que
 * ele administra E que participam daquela operação.** As duas condições são
 * necessárias — administrar uma delegacia não dá acesso a uma operação de que
 * ela não faz parte, e participar da operação não torna a unidade escrevível por
 * quem não a administra.
 *
 * Existe como resolvedor próprio, e não como mais um `if` na rota, pelo motivo
 * registrado no `CLAUDE.md`: a `unidade_id` chega no CORPO do POST, não na URL.
 * Um handler que confia nesse valor deixa qualquer admin autenticado reescrever
 * a base de qualquer delegacia — o mesmo formato do FLW-ESC-002, em que membro
 * de outra escala virava editável por ID.
 *
 * Espelha `adminParticipaDaGise` (`$lib/server/gise/permissao`), estendido ao
 * SLOT de unidade: na CRAJUBAR são as delegacias do Crato e de Barbalha que
 * entram por slot, e ignorá-los deixaria de fora justamente quem o plano nomeia.
 */
import { eq } from 'drizzle-orm';
import { unidades } from '$lib/server/schema';
import { isAdminGeral, isAdminSeccional, isAdminUnidade } from '$lib/auth';
import { unidadesParticipantesDaOperacao } from '$lib/db/operacoes';
import type { Database } from '$lib/db';

/**
 * As unidades cuja base este usuário pode ler e escrever nesta operação.
 *
 * Set VAZIO significa "nenhuma" — e é o resultado correto para o policial sem
 * papel, para o admin de uma unidade que não participa, e para quem tem papel
 * mas está sem `papel_unidade_id`. O chamador transforma vazio em 403; nunca em
 * "então mostra tudo".
 *
 * Admin Geral recebe todas as participantes (não `null`): a tela precisa da
 * lista concreta para renderizar as linhas, e um `null` de "irrestrito" só
 * empurraria a expansão para cada call site.
 */
export async function unidadesLinhaBaseAdministradas(
	db: Database,
	u: App.Locals['usuario'],
	operacaoId: number
): Promise<Set<number>> {
	if (!u) return new Set();

	const participantes = await unidadesParticipantesDaOperacao(db, operacaoId);
	const idsParticipantes = new Set(participantes.map((p) => p.id));

	if (isAdminGeral(u)) return idsParticipantes;

	// O escopo vem do PAPEL, não da lotação (FLW-RBAC-003) — mesma regra de
	// `lotacoesAdministradas`. Sem unidade de papel não há escopo algum.
	const papelUnidadeId = u.papel_unidade_id;
	if (papelUnidadeId == null) return new Set();

	if (isAdminUnidade(u)) {
		return idsParticipantes.has(papelUnidadeId) ? new Set([papelUnidadeId]) : new Set();
	}

	if (isAdminSeccional(u)) {
		// A própria seccional mais as unidades subordinadas a ela — mesma expansão
		// de `lotacoesDaSeccional`, por id em vez de por nome, porque aqui o alvo é
		// `operacao_linha_base.unidade_id`.
		const subordinadas = await db
			.select({ id: unidades.id })
			.from(unidades)
			.where(eq(unidades.seccional_id, papelUnidadeId))
			.all();

		const doEscopo = new Set<number>([papelUnidadeId, ...subordinadas.map((s) => s.id)]);
		return new Set([...doEscopo].filter((id) => idsParticipantes.has(id)));
	}

	return new Set();
}

/**
 * O usuário pode escrever a base desta unidade nesta operação?
 *
 * Atalho para o caso de UMA unidade — a gravação vinda do formulário de
 * produtividade, em que a unidade já foi resolvida no servidor. A pergunta é a
 * mesma; só o formato da resposta muda.
 */
export async function podeInformarLinhaBase(
	db: Database,
	u: App.Locals['usuario'],
	operacaoId: number,
	unidadeId: number
): Promise<boolean> {
	const permitidas = await unidadesLinhaBaseAdministradas(db, u, operacaoId);
	return permitidas.has(unidadeId);
}
