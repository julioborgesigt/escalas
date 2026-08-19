/**
 * "A escala GISE já foi assinada pelo supervisor?" — em UM lugar só.
 *
 * A escada de status tem oito degraus, e `aguardando_assinatura` é o último
 * ANTES da assinatura do documento principal. Tudo daí para frente conta como
 * assinado, inclusive `finalizada`: a pergunta é "já passou do degrau", não
 * "está no degrau".
 *
 * Isto estava copiado em SETE lugares, e três deles no servidor:
 *
 *   - os dois diálogos de `gise/+page.svelte` e o `escalaConcluida` do
 *     `CardGiseAtiva` — como array literal;
 *   - o `podeReabrir` de `gise/[id]/+page.svelte` — como cadeia de `||`;
 *   - a validação de reabertura em `[id]/_actions/actions-escala.ts` — array;
 *   - o portão de `api/gise/[id]/reabrir` e o de `api/gise/[id]/download`
 *     ("Download só é liberado após a assinatura do Supervisor") — como cadeia
 *     de `!==`.
 *
 * As três formas sintáticas são o motivo de a contagem original ter sido
 * QUATRO: procurar pelo array literal não acha a cadeia de `!==`. Duas cópias
 * vinham com comentário explicando a regra, o que não impediu nada — um nono
 * status no ciclo precisaria ser lembrado nos sete pontos, e três deles
 * AUTORIZAM (reabrir por action, reabrir por API, baixar). Esquecer um desses
 * não deixa a tela errada, deixa a permissão errada.
 *
 * O par mais perigoso era `actions-escala` × `api/.../reabrir`: dois portões
 * para a MESMA operação, escritos diferente, mantidos em arquivos que ninguém
 * abre junto.
 *
 * Módulo PURO e client-safe de propósito, como `finalizacao.ts` e pelo mesmo
 * motivo: quem decide (a action) e quem avisa (o card, o diálogo) precisam da
 * MESMA resposta. A máquina de estados completa vive em
 * `$lib/db/gise/escalas-status.ts` — que é servidor-only porque importa
 * drizzle, e por isso não pode ser a casa deste predicado.
 */

/**
 * Status a partir dos quais o documento da escala já foi assinado.
 *
 * Ordem = a da escada, para que ler a lista mostre o corte.
 */
export const STATUS_ESCALA_ASSINADA = [
	'em_andamento',
	'aguardando_relatorios',
	'aguardando_assinatura_relat',
	'pronta_para_finalizar',
	'finalizada'
] as const;

/** `true` quando a escala já foi assinada e seguiu adiante na escada. */
export function escalaGiseJaAssinada(status: string): boolean {
	return (STATUS_ESCALA_ASSINADA as readonly string[]).includes(status);
}
