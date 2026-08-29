import { describe, it, expect } from 'vitest';
import { contentDisposition } from '../api';

/**
 * `contentDisposition` monta o header a partir de nome que pode vir DE FORA.
 *
 * Dois call sites servem o nome do arquivo como o navegador do remetente o
 * enviou — `policiais/historico/[eventoId]/documento` e
 * `policiais/solicitacoes/[solicitacaoId]/documento`, ambos lendo o
 * `documento_nome` gravado por `uploadDocumento`, que só faz `slice(0, 200)`.
 * Quem escolhe o nome é quem sobe a portaria, não o servidor.
 *
 * O que estes testes fixam é a saída ser um header BEM FORMADO para qualquer
 * entrada — as duas metades (`filename=` e `filename*=`) têm gramáticas
 * diferentes, e cada uma tem um conjunto próprio de caracteres que precisa
 * sair codificado.
 */
describe('contentDisposition', () => {
	it('mantém o caso comum legível nas duas metades', () => {
		expect(contentDisposition('Escala 2026-01-15.pdf')).toBe(
			'attachment; filename="Escala 2026-01-15.pdf"; filename*=UTF-8\'\'Escala%202026-01-15.pdf'
		);
	});

	/**
	 * Barra invertida final: sem escapá-la, o `\` do nome vira o quote-pair do
	 * `"` de fechamento e a quoted-string NUNCA fecha — o parser passa a ler
	 * `; filename*=UTF-8''...` como parte do nome do arquivo.
	 */
	it('escapa a barra invertida para não engolir a aspa de fechamento', () => {
		const header = contentDisposition('portaria\\');
		expect(header).toContain('filename="portaria\\\\"');
		expect(aspasDelimitadoras(header)).toBe(2);
	});

	it('escapa barra e aspa juntas sem inverter a ordem', () => {
		const header = contentDisposition('a\\"b.pdf');
		expect(header).toContain('filename="a\\\\\\"b.pdf"');
		expect(aspasDelimitadoras(header)).toBe(2);
	});

	/**
	 * RFC 8187: o `value-chars` do `filename*` aceita `pct-encoded` ou
	 * `attr-char`, e `attr-char` NÃO inclui `'`, `(`, `)` nem `*` — que são
	 * justamente os que `encodeURIComponent` deixa passar. A apóstrofe é a que
	 * machuca: a gramática é `charset "'" [language] "'" value-chars`, então uma
	 * terceira apóstrofe faz um parser estrito cortar o valor no lugar errado.
	 */
	it('codifica os caracteres que o RFC 8187 não admite em filename*', () => {
		const header = contentDisposition("o'brien (final)*.pdf");
		expect(header).toContain("filename*=UTF-8''o%27brien%20%28final%29%2A.pdf");
		// Exatamente as duas apóstrofes que a gramática do ext-value exige. A
		// contagem é sobre o ext-value, não sobre o header: dentro da
		// quoted-string do `filename=` a apóstrofe é caractere comum e fica.
		const extValue = header.slice(header.indexOf('filename*='));
		expect(extValue.match(/'/g)?.length).toBe(2);
	});

	/** CR/LF morrem nas duas metades — sem isso o header vira response splitting. */
	it('neutraliza CR/LF nas duas metades', () => {
		const header = contentDisposition('quebra\r\nX-Injetado: 1.pdf');
		expect(header).not.toMatch(/[\r\n]/);
		expect(header).toContain('filename="quebra__X-Injetado: 1.pdf"');
		expect(header).toContain('%0D%0A');
	});

	it('substitui não-ASCII no fallback e preserva o nome em filename*', () => {
		const header = contentDisposition('Relatório Extraordinário.pdf');
		expect(header).toContain('filename="Relat_rio Extraordin_rio.pdf"');
		expect(header).toContain("filename*=UTF-8''Relat%C3%B3rio%20Extraordin%C3%A1rio.pdf");
	});
});

/**
 * Conta as aspas que DELIMITAM a quoted-string, ignorando as escapadas
 * (`\"`). Um header bem formado tem exatamente duas.
 */
function aspasDelimitadoras(header: string): number {
	let n = 0;
	for (let i = 0; i < header.length; i++) {
		if (header[i] === '\\') {
			i++; // pula o caractere escapado
			continue;
		}
		if (header[i] === '"') n++;
	}
	return n;
}
