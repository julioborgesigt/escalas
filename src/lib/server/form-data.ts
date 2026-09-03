/**
 * Leitura LIMITADA de campo de texto vindo de `FormData` — o cap que o
 * `maxlength` da tela promete e o servidor precisa impor de novo.
 *
 * `maxlength` é dica de digitação: some num POST direto, num `curl`, ou com uma
 * linha no devtools. Rota de API não cai nessa porque o padrão obrigatório do
 * projeto é `validateBody` com Zod (que tem `.max()`); **form action lê
 * `FormData` na mão**, e é aí que o limite fica só na tela.
 *
 * Este módulo existe porque a regra já estava certa em dois lugares e ausente
 * num terceiro — a forma exata dos bugs catalogados no `CLAUDE.md`.
 * `gise/operacoes/+page.server.ts` e `gise/planos/novo/+page.server.ts` tinham
 * CADA UM a sua cópia de `texto(fd, campo, max)`, idêntica linha a linha; com a
 * regra sem casa própria, `salvarBreveRelatorio` (que grava as MESMAS três
 * colunas que `operacoes` limita a 200/2000) e as `observacoes` da escala
 * nasceram sem cap nenhum. Texto ilimitado ali não é só uma coluna que cresce:
 * os dois vão para dentro de PDF assinado.
 *
 * Corta em vez de recusar, de propósito — é a semântica que as duas cópias já
 * tinham, e a mesma do `maxlength`: quem digita na tela não consegue passar do
 * limite, então truncar só alcança quem contornou a tela. Onde o excesso precisa
 * ser DENUNCIADO em vez de aparado (a justificativa da ficha do servidor, que
 * recusa com mensagem), o call site continua fazendo a sua própria checagem.
 */

/**
 * Campo de texto: `trim()` e no máximo `max` caracteres. Ausente vira `''`.
 *
 * `max` deve ser o MESMO número do `maxlength` do campo na tela — divergir faz
 * a tela prometer um limite e o banco guardar outro.
 */
export function textoLimitado(fd: FormData, campo: string, max: number): string {
	return String(fd.get(campo) ?? '')
		.trim()
		.slice(0, max);
}

/**
 * O mesmo, com `''` virando `null` — para coluna anulável onde vazio significa
 * "não informado" (e, em `operacoes`, "herda o padrão") em vez de string vazia.
 */
export function textoLimitadoOuNulo(fd: FormData, campo: string, max: number): string | null {
	const v = textoLimitado(fd, campo, max);
	return v === '' ? null : v;
}

/**
 * Comprimento máximo de um endereço de e-mail (RFC 5321 §4.5.3.1.3).
 *
 * Existe porque validar e-mail por regex prova o FORMATO e não o TAMANHO:
 * `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` casa com um endereço de um megabyte. Os três
 * call sites que liam e-mail de `FormData` (o do assessor da GISE e os dois de
 * destino do FDS) tinham o regex e nenhum limite.
 */
export const MAX_EMAIL = 254;

/**
 * Observação por servidor escalado — o `maxlength` das QUATRO telas que a editam
 * (`FormAdicionarServidores`, `TabelaServidores` em dois pontos e
 * `ModalEditarPlantao`).
 *
 * O servidor não tinha limite: as actions liam
 * `data.get('observacoes')?.toString() || ''` e gravavam. A coluna é
 * `text NOT NULL DEFAULT ''` sem CHECK, e o valor é impresso no PDF da escala —
 * que é documento assinado.
 */
export const MAX_OBSERVACOES = 500;
