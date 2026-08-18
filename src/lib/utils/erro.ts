/**
 * Normalização de valores lançados em `catch`.
 *
 * `catch (e)` tipa `e` como `unknown` porque JavaScript deixa lançar
 * qualquer coisa — `Error`, string, `undefined`, um objeto de rejeição de
 * biblioteca. Toda mensagem que vai para toast, `errors.push` ou log precisa
 * do mesmo estreitamento, e ele estava reescrito como `messageFromUnknown`
 * em três módulos (assinatura GISE, presença res-gise, webhook de unidades).
 */

/**
 * Mensagem legível de um valor capturado em `catch`.
 *
 * Devolve `e.message` para `Error` (o que inclui as mensagens do servidor
 * relançadas por `$lib/api-fetch`, com o `errorId` rastreável) e `String(e)`
 * para o resto.
 */
export function mensagemDeErro(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}
