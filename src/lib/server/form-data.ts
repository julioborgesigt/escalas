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

/**
 * Inteiro de `FormData` dentro de uma faixa, ou `null` quando ausente/inválido.
 *
 * O par com `textoLimitado`, para o outro tipo de trava que a tela promete e o
 * servidor precisa repetir: `min`/`max` de `<input type="number">`. Quem chama
 * decide o que fazer com `null` — recusar (é o caso das vagas de equipe) ou cair
 * num padrão.
 *
 * Devolve `null` também para vazio, para o chamador distinguir "não informado"
 * de zero: em vagas de equipe `0` é uma afirmação (equipe sem aquela vaga), e
 * tratar os dois igual faz "0 DPC" virar outro número no salvamento seguinte.
 */
export function inteiroNaFaixa(
	fd: FormData,
	campo: string,
	min: number,
	max: number
): number | null {
	const bruto = String(fd.get(campo) ?? '').trim();
	if (bruto === '') return null;
	// Dígitos decimais, e só. `Number()` sozinho aceita as notações do JavaScript:
	// `Number('0x10')` é 16 e `Number('1e3')` é 1000 — nenhuma das duas sai de um
	// `<input type="number">`, e um validador que aceita grafia que a tela não
	// produz é um validador com entrada por onde não se olha.
	if (!/^-?\d+$/.test(bruto)) return null;
	const n = Number(bruto);
	if (!Number.isInteger(n) || n < min || n > max) return null;
	return n;
}

/**
 * O campo veio PREENCHIDO?
 *
 * Existe para separar "não informado" de "informado e inválido": os leitores
 * acima devolvem `null` para os dois, e quem chama precisa recusar só o
 * segundo — em vaga de equipe e horário herdado, vazio é uma resposta legítima
 * ("herda do pai"), então tratar os dois igual transformaria "deixe em branco"
 * em erro de validação.
 */
export function informado(fd: FormData, campo: string): boolean {
	return String(fd.get(campo) ?? '').trim() !== '';
}

/**
 * Data `YYYY-MM-DD` de `FormData`, ou `null` quando ausente/inválida.
 *
 * O terceiro membro da família de `textoLimitado` e `inteiroNaFaixa`: o que
 * `<input type="date">` promete e o servidor precisa repetir. Aqui a repetição
 * vale mais que nas outras duas, porque a data da GISE alimenta o PORTÃO da
 * janela de presença — e `horarioGiseLiberado` falha ABERTO de propósito
 * (`isNaN(alvo.getTime()) → return true`, para não trancar a GISE inteira por
 * um dado ruim). Fail-open é a escolha certa lá; o preço é que uma data
 * inválida gravada aqui LIBERA a confirmação de presença fora do horário para
 * todos os membros daquela escala, sem erro nenhum. Validar na ESCRITA é o que
 * dá piso ao portão sem mexer no fail-open.
 *
 * Confere o CALENDÁRIO, não só o formato: `2026-02-31` casa com
 * `/^\d{4}-\d{2}-\d{2}$/` e é `Invalid Date` — exatamente o valor que faz o
 * portão liberar.
 */
export function dataIso(fd: FormData, campo: string): string | null {
	const bruto = String(fd.get(campo) ?? '').trim();
	if (!/^\d{4}-\d{2}-\d{2}$/.test(bruto)) return null;
	// `new Date('2026-02-31')` não lança: normaliza para 03/03. Comparar de volta
	// é o que separa data real de data que só PARECE data.
	const d = new Date(`${bruto}T00:00:00Z`);
	if (isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== bruto) return null;
	return bruto;
}

/**
 * Hora de `FormData` NORMALIZADA para `HH:MM`, ou `null` quando ausente/inválida.
 *
 * O par de `dataIso`, e pelo mesmo motivo: é a hora que o portão de presença
 * compara, e ele libera quando ela não parseia.
 *
 * **Aceita `H:MM` além de `HH:MM` porque é o que a tela manda.** O contrato do
 * cliente é `validarHora` (`$lib/gise/horarios`), que testa
 * `/^\d{1,2}:\d{2}$/`, e `normalizarHora` só troca `.`/`,` por `:` — não
 * preenche o zero. Ou seja, `8:00` sai do formulário legítimo, e um validador
 * de servidor exigindo dois dígitos recusaria o usuário que digitou certo.
 *
 * Devolve SEMPRE com zero à esquerda. Sendo preciso sobre o que isso compra:
 * NÃO é consertar comparação quebrada — o projeto já tem `mesmaHora`
 * (`$lib/gise/horarios`) justamente porque a divergência `8:00`/`08:00` existe,
 * e `horarioGiseLiberado` preenche o zero antes de comparar. O que a
 * normalização na escrita faz é parar de PRODUZIR a divergência, para que a
 * grafia canônica no banco seja a regra e não a sorte de qual caminho gravou.
 * Não normaliza o que já está gravado, nem o padrão que vem de
 * `hora_entrada_padrao` (gravado por `gise/operacoes`, que valida mas não
 * preenche o zero) — essas linhas continuam dependendo de `mesmaHora`.
 *
 * As colunas de escala ordinária usam outra convenção (`'08'`, só a hora); este
 * helper não serve para elas.
 */
export function horaHhMm(fd: FormData, campo: string): string | null {
	const bruto = String(fd.get(campo) ?? '').trim();
	const m = /^(\d{1,2}):(\d{2})$/.exec(bruto);
	if (!m) return null;
	const h = Number(m[1]);
	const min = Number(m[2]);
	if (h > 23 || min > 59) return null;
	return `${String(h).padStart(2, '0')}:${m[2]}`;
}

/**
 * Hora `HH:MM` de um campo só, com PADRÃO quando o campo não veio.
 *
 * `horaHhMm` devolve `null` para ausente e para inválido, e quem chama quase
 * sempre precisa separar os dois: campo em branco herda o padrão da escala,
 * campo preenchido errado tem de recusar. A dança `informado(...) && x === null`
 * estava para ser escrita pela quarta vez quando este helper nasceu.
 *
 * Devolve `null` SÓ para informado-e-inválido — é o único caso em que o chamador
 * precisa recusar.
 */
export function horaOuPadrao(fd: FormData, campo: string, padrao: string): string | null {
	if (!informado(fd, campo)) return padrao;
	return horaHhMm(fd, campo);
}

/**
 * Hora `HH:MM` montada de DOIS campos separados — a segunda convenção da escala
 * ordinária.
 *
 * `FormAdicionarServidores` manda `hora_entrada=08` e `minuto_entrada=00` em
 * campos distintos, e a action concatenava `${hora}:${minuto}` sem conferir
 * nenhum dos dois: `hora_entrada=99` virava `99:00` gravado na coluna e
 * IMPRESSO no PDF assinado. O mesmo arquivo tem a outra convenção
 * (`hora_entrada=08:00`, campo único) — são as duas grafias que o `CLAUDE.md`
 * cataloga na família "fallback de hora do plantão", e este helper existe para
 * que as duas produzam a MESMA saída canônica.
 *
 * Devolve `null` só quando algum dos dois veio preenchido e inválido; ausente
 * cai nos padrões recebidos.
 */
export function horaDeCamposSeparados(
	fd: FormData,
	campoHora: string,
	campoMinuto: string,
	horaPadrao: number,
	minutoPadrao: number
): string | null {
	const h = informado(fd, campoHora) ? inteiroNaFaixa(fd, campoHora, 0, 23) : horaPadrao;
	const m = informado(fd, campoMinuto) ? inteiroNaFaixa(fd, campoMinuto, 0, 59) : minutoPadrao;
	if (h === null || m === null) return null;
	return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
