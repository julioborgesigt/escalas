/**
 * Os textos PADRÃO do plano operacional — o que o formulário oferece
 * pré-preenchido e o que o documento imprime quando o campo fica vazio.
 *
 * Mora em `$lib/planos/` e não no `+page.server.ts` da rota por uma razão
 * mecânica: **SvelteKit recusa export arbitrário de `+page.server.ts`** (só
 * `load`, `actions`, `prerender`, `csr`, `ssr`, `trailingSlash`, `config`,
 * `entries`, ou algo com prefixo `_`). Uma constante exportada dali derruba a
 * rota inteira em runtime com "Invalid export" — e passa por `svelte-check` e
 * pelos testes sem um aviso, porque é validação do roteador, não do TypeScript.
 *
 * Aqui eles também ficam ao alcance do gerador do PDF, que precisa dos mesmos
 * textos para o plano criado antes de estes campos existirem.
 */

/**
 * Finalidade padrão — item 1 do documento. Editável no formulário.
 *
 * Reproduz literalmente o texto em uso na corporação. **Vale conferir antes do
 * primeiro plano emitido:** ele diz "Departamento de Polícia Judiciária do
 * Interior Sul", e o cabeçalho de `$lib/institucional` registra que esse órgão
 * NÃO existe no organograma — o nome correto é "Departamento de Polícia do
 * Interior Sul — DPI SUL". Fica como está por ter sido ditado assim e por ser
 * campo editável; corrigi-lo por conta própria mudaria o texto de um documento
 * oficial sem ninguém ter pedido.
 */
export const FINALIDADE_PADRAO =
	'Cumprimento de mandados judiciais, através da 4ª Seccional do Interior Sul, ' +
	'integrante do Departamento de Polícia Judiciária do Interior Sul, com as ' +
	'diretrizes da Delegacia Geral da Polícia Civil.';

/** Ações padrão do item 2b ("Ações a serem realizadas"), uma por linha. */
export const ACOES_PADRAO = [
	'Cumprimento de Mandados;',
	'Lavratura de APF;',
	'TCO e Inquéritos;',
	'Outros atos de Polícia Judiciária.'
].join('\n');

/** Item 3 do documento — fixo, sem campo no formulário. */
export const REFERENCIAS_PADRAO = 'Constituição Federal, CPP e legislação extravagante.';

/** Horário de apresentação pré-preenchido na criação. */
export const HORA_INICIO_PADRAO = '04:00';

/** Previsão de término pré-preenchida na criação (o campo continua opcional). */
export const HORA_FIM_PADRAO = '08:00';

/**
 * Os cargos que podem assinar o plano — o `<select>` da tela e a régua do
 * servidor, numa lista só, GERADA a partir do departamento.
 *
 * É lista fechada, e não campo livre, porque o cargo aparece IMPRESSO sob a
 * assinatura de um documento oficial: "Diretor Titular" digitado com um dedo
 * torto sai no papel e ninguém revisa depois. Os três são os que assinam plano
 * num departamento.
 *
 * O órgão vai POR EXTENSO ("Diretor Titular do Departamento de Polícia do
 * Interior Sul"), nunca pela sigla: sob a assinatura o cargo é qualificação da
 * autoridade que decide, e abreviação em documento que circula assinado
 * empobrece o ato (plano do módulo de diárias, decisão 69). O nome vem de
 * `unidades.nome` — o departamento é dado, não constante (decisão 17), e é o
 * que permite o mesmo código servir outro departamento sem edição.
 *
 * Sem departamento cadastrado (não deveria acontecer: a migração 0006 semeia o
 * DPI SUL), a lista sai sem o órgão, em vez de imprimir "do " seguido de nada.
 */
export function cargosSignatario(departamentoNome: string): readonly string[] {
	const nome = departamentoNome.trim();
	const sufixo = nome ? ` do ${nome}` : '';
	return [`Diretor Titular${sufixo}`, `Diretor Adjunto${sufixo}`, 'Delegado de Polícia'];
}

/** Um cargo de signatário — sempre um dos de `cargosSignatario`. */
export type CargoSignatario = string;

/**
 * O cargo, se for um dos válidos para este departamento; senão o primeiro
 * (Diretor Titular).
 *
 * O `<select>` da tela já limita a escolha, mas o POST direto não — e cargo
 * livre vindo do corpo iria impresso no documento sem passar por revisão
 * nenhuma. É a mesma razão de o servidor não confiar no `disabled` de um botão.
 */
export function cargoSignatarioValido(valor: string, cargos: readonly string[]): CargoSignatario {
	return cargos.includes(valor) ? valor : cargos[0];
}
