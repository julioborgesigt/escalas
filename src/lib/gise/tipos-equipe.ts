/**
 * Quais tipos de equipe uma operação habilita — a versão de CLIENTE.
 *
 * Existe separada de `tiposEquipeDaOperacao` (`$lib/db/operacoes/crud`) porque
 * aquela importa `$lib/server/schema` e não pode atravessar para o navegador. A
 * regra em si é a mesma, e ela tem dois call sites de tela: o editor de
 * formulário em `/res-gise` e o filtro de tipo de equipe em `/produtividade`.
 *
 * O fallback quando a operação não habilita nada NÃO é lista vazia: o banco
 * aceita `(0,0)` e a aplicação não — operação sem tipo de equipe não escala
 * ninguém e deixaria a tela sem aba nenhuma para mostrar. Cai em `operacional`,
 * que é o histórico.
 *
 * Isto NÃO é autorização: quem recusa a gravação de um tipo desabilitado é a
 * action no servidor. Aqui é só o que a tela oferece.
 */

/** Os tipos de equipe, na ordem em que a UI os apresenta. */
export type TipoEquipe = 'operacional' | 'seint';

/** Os tipos que ESTA operação usa. `null`/indefinida devolve os dois. */
export function tiposEquipeHabilitados(
	op: { usa_equipe_operacional: boolean; usa_equipe_seint: boolean } | null | undefined
): TipoEquipe[] {
	if (!op) return ['operacional', 'seint'];
	const t: TipoEquipe[] = [];
	if (op.usa_equipe_operacional) t.push('operacional');
	if (op.usa_equipe_seint) t.push('seint');
	return t.length > 0 ? t : ['operacional'];
}
