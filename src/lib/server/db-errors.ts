/**
 * Leitura de erros vindos do D1/Drizzle.
 *
 * O Drizzle embrulha a falha do driver: `error.message` traz só
 * `"Failed query: insert into ..."` (com o SQL e os parâmetros), e o motivo
 * real fica em `error.cause` — dois níveis abaixo, no caso do D1:
 *
 * ```
 * Error: Failed query: insert into "unidades" ...
 *   └ Error: D1_ERROR: UNIQUE constraint failed: unidades.nome: SQLITE_CONSTRAINT
 *       └ Error: UNIQUE constraint failed: unidades.nome: SQLITE_CONSTRAINT
 * ```
 *
 * Por isso testar `e.message.includes('UNIQUE')` nunca funciona: as rotas que
 * faziam isso devolviam 500 com o SQL cru em vez do 409 amigável.
 */

/** Mensagem do erro concatenada com a de toda a cadeia `cause`. */
export function mensagemComCausas(e: unknown, maxNiveis = 6): string {
	const partes: string[] = [];
	let atual: unknown = e;
	for (let i = 0; i < maxNiveis && atual != null; i++) {
		if (atual instanceof Error) {
			partes.push(atual.message);
			atual = (atual as Error & { cause?: unknown }).cause;
		} else {
			partes.push(String(atual));
			break;
		}
	}
	return partes.join(' | ');
}

/** Violação de índice único (matrícula/nome duplicado, replay de nonce...). */
export function ehViolacaoUnique(e: unknown): boolean {
	return /UNIQUE constraint failed/i.test(mensagemComCausas(e));
}
