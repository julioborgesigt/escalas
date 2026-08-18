/**
 * Normalização de valores lançados em `catch`.
 *
 * `catch (e)` tipa `e` como `unknown` porque JavaScript deixa lançar
 * qualquer coisa — `Error`, string, `undefined`, um objeto de rejeição de
 * biblioteca. Toda mensagem que vai para toast, `errors.push` ou log precisa
 * do mesmo estreitamento, e ele estava escrito à mão em ~130 pontos de `src/`
 * (mais três cópias nomeadas `messageFromUnknown`), em duas variantes: cair
 * para `String(e)` ou cair para uma frase fixa.
 */

/**
 * Mensagem legível de um valor capturado em `catch`.
 *
 * Devolve `e.message` para `Error` — o que inclui as mensagens do servidor
 * relançadas por `$lib/api-fetch`, com o `errorId` rastreável.
 *
 * Para o que não é `Error`, as duas variantes são deliberadamente diferentes e
 * a escolha importa:
 *
 * - **sem `fallback`** → `String(e)`, que PRESERVA o valor lançado. É o certo
 *   para log, auditoria e `errors.push` de webhook, onde jogar fora o que veio
 *   custa a única pista do que aconteceu.
 * - **com `fallback`** → a frase fixa, DESCARTANDO o valor. É o certo para
 *   texto de UI, onde `String(e)` produziria `[object Object]` ou `undefined`
 *   na cara do usuário.
 *
 * @param e valor capturado no `catch`.
 * @param fallback frase para quando `e` não é `Error`. Omitido, usa `String(e)`.
 */
export function mensagemDeErro(e: unknown, fallback?: string): string {
	if (e instanceof Error) return e.message;
	return fallback ?? String(e);
}
