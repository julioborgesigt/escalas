/**
 * As regras das LISTAS de opções do plano, em forma pura.
 *
 * Aqui e não em `$lib/db/planos/opcoes.ts` porque quem chama é componente de
 * TELA, e `$lib/db` arrasta o drizzle e o schema do servidor para dentro do
 * bundle do navegador. O que estas funções precisam saber de uma opção é só o
 * `valor` (e, para as de lista, o `padrao`) — daí os parâmetros tipados pela
 * forma, não pela linha da tabela.
 *
 * ## Por que as regras de lista existem DUAS vezes
 *
 * "A primeira de cada tipo é a padrão", "não repetir valor" e "removida a
 * padrão, a primeira das restantes assume" valem nos dois lados:
 *
 * - no EDITOR, onde o plano existe, quem as aplica é `$lib/db/planos/opcoes.ts`
 *   contra o banco — e a exclusividade da padrão é arbitrada por índice único
 *   parcial, que é o que fecha a corrida entre duas abas;
 * - na CRIAÇÃO, onde o plano ainda não existe, a lista é um array em memória e
 *   não há banco para arbitrar coisa alguma.
 *
 * Não dá para o array chamar o SQL. O que dá — e é o que este módulo faz — é
 * enunciar a regra UMA vez, testada, e deixar o lado do banco apontar para cá.
 * Sem isso, a tela de criação produziria uma lista cuja padrão não é a que o
 * editor produziria para os mesmos cliques, e ninguém notaria até uma equipe
 * nascer com o destino errado.
 */

/** O mínimo que uma opção precisa ter para virar item de seletor. */
export type OpcaoSelecionavel = { valor: string };

/** Uma opção de lista ainda não gravada: sem `id`, porque o plano não existe. */
export type OpcaoEmLista = { valor: string; padrao: boolean };

/**
 * As opções do plano MAIS o valor que a equipe já tem, quando ele não está na
 * lista — nessa ordem, com o valor próprio à frente.
 *
 * O acréscimo não é cortesia: é o que impede perda silenciosa. A equipe guarda
 * o TEXTO, não uma referência à opção (é o que permite remover uma opção sem
 * esvaziar equipe montada), então uma equipe anterior à lista — ou cuja opção
 * foi removida depois — abriria o `<select>` sem o próprio valor entre os
 * `<option>`. O navegador então exibe o primeiro item, e salvar sem tocar no
 * campo trocaria o destino impresso no Anexo I sem que ninguém tivesse pedido.
 *
 * `null` e string em branco são a mesma coisa aqui: equipe sem valor próprio,
 * que herda o padrão do plano (ver `briefingDaEquipe`/`destinoDaEquipe`).
 */
export function escolhasDaEquipe(opcoes: OpcaoSelecionavel[], atual: string | null): string[] {
	const valores = opcoes.map((o) => o.valor);
	const limpo = (atual ?? '').trim();
	return limpo && !valores.includes(limpo) ? [limpo, ...valores] : valores;
}

/**
 * Acrescenta um valor à lista. A PRIMEIRA de cada lista nasce padrão.
 *
 * Nasce padrão porque uma lista com opções e nenhuma padrão daria equipe nova
 * com o campo vazio — e quem acabou de cadastrar a única opção não espera
 * precisar marcá-la também. É a mesma decisão de `adicionarOpcao` no lado do
 * banco.
 *
 * Valor repetido é IGNORADO, e a lista volta como está: duas linhas idênticas
 * no seletor não ajudam ninguém a escolher. No banco quem recusa é o índice;
 * aqui, esta comparação.
 */
export function acrescentarNaLista(lista: OpcaoEmLista[], valor: string): OpcaoEmLista[] {
	const limpo = valor.trim().slice(0, 200);
	if (!limpo || lista.some((o) => o.valor === limpo)) return lista;
	return [...lista, { valor: limpo, padrao: lista.length === 0 }];
}

/**
 * Marca um valor como padrão, tirando a marca de todos os outros.
 *
 * Valor ausente da lista não muda nada — e, sobretudo, não deixa a lista sem
 * padrão nenhuma no caminho.
 */
export function definirPadraoNaLista(lista: OpcaoEmLista[], valor: string): OpcaoEmLista[] {
	if (!lista.some((o) => o.valor === valor)) return lista;
	return lista.map((o) => ({ ...o, padrao: o.valor === valor }));
}

/**
 * Remove um valor. Se ele era a padrão, a PRIMEIRA das restantes assume.
 *
 * Deixar a lista sem padrão faria a próxima equipe nascer com o campo vazio sem
 * que ninguém tivesse pedido isso, e o motivo (a padrão foi removida) não
 * estaria em lugar nenhum da tela.
 */
export function removerDaLista(lista: OpcaoEmLista[], valor: string): OpcaoEmLista[] {
	const restantes = lista.filter((o) => o.valor !== valor);
	if (restantes.length === 0 || restantes.some((o) => o.padrao)) return restantes;
	return restantes.map((o, i) => ({ ...o, padrao: i === 0 }));
}

/** O valor da padrão, ou `''` quando a lista está vazia ou sem estrela. */
export function padraoDaLista(lista: OpcaoEmLista[]): string {
	return lista.find((o) => o.padrao)?.valor ?? '';
}
