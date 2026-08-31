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

/** Departamento responsável (item 5 e o cabeçalho do plano). */
export const DEPARTAMENTO_PADRAO = 'DPI SUL';

/**
 * Os cargos que podem assinar o plano — o `<select>` da tela e a régua do
 * servidor, numa lista só.
 *
 * É lista fechada, e não campo livre, porque o cargo aparece IMPRESSO sob a
 * assinatura de um documento oficial: "Diretor Titular" digitado com um dedo
 * torto sai no papel e ninguém revisa depois. Os três são os que assinam plano
 * no DPI SUL.
 *
 * `as const` para o tipo sair do próprio dado: acrescentar um cargo aqui já o
 * oferece na tela e o torna aceito no servidor, sem uma segunda lista.
 */
export const CARGOS_SIGNATARIO = [
	'Diretor Titular do DPI SUL',
	'Diretor Adjunto do DPI SUL',
	'Delegado de Polícia'
] as const;

/** Um cargo de signatário válido. */
export type CargoSignatario = (typeof CARGOS_SIGNATARIO)[number];

/** O cargo pré-selecionado quando o plano nasce sem padrão gravado. */
export const CARGO_SIGNATARIO_PADRAO: CargoSignatario = CARGOS_SIGNATARIO[0];

/**
 * O cargo, se for um dos válidos; senão o padrão.
 *
 * O `<select>` da tela já limita a escolha, mas o POST direto não — e cargo
 * livre vindo do corpo iria impresso no documento sem passar por revisão
 * nenhuma. É a mesma razão de o servidor não confiar no `disabled` de um botão.
 */
export function cargoSignatarioValido(valor: string): CargoSignatario {
	return (CARGOS_SIGNATARIO as readonly string[]).includes(valor)
		? (valor as CargoSignatario)
		: CARGO_SIGNATARIO_PADRAO;
}
