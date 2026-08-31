/**
 * O que os seletores de briefing e de destino da equipe oferecem.
 *
 * Regra pura, e por isso aqui e não em `$lib/db/planos/opcoes.ts`: quem a chama
 * é um componente de TELA, e `$lib/db` arrasta o drizzle e o schema do servidor
 * para dentro do bundle do navegador. O que ela precisa saber de uma opção é só
 * o `valor` — daí o parâmetro tipado pela forma, não pela linha da tabela.
 */

/** O mínimo que uma opção precisa ter para virar item de seletor. */
export type OpcaoSelecionavel = { valor: string };

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
