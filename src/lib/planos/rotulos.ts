/**
 * Os rótulos que a TELA e o PDF do plano operacional dizem — fonte única.
 *
 * Existe porque estes textos aparecem nos dois lugares, e a tabela de duplicação
 * do `CLAUDE.md` é uma lista de casos em que exatamente isso deu errado: a
 * mesma lógica em dois arquivos, uma cópia corrigida, a outra não. Aqui o
 * sintoma seria o painel de custos da tela dizer "Hora extra" e o documento
 * assinado dizer "DRO" — quem confere um contra o outro não teria como saber
 * que são a mesma coisa.
 *
 * A grafia é a do modelo de plano operacional fornecido pela corporação, não
 * uma escolha de estilo: **DRO** é "Diária de Reforço Operacional", que é como
 * a hora extra é chamada no documento, e o Anexo II traz o título por extenso.
 */
import type { TipoDiaria } from './diarias';
import { ROTULO_DIARIA } from './diarias';

/** Como a equipe é paga. Espelha `plano_equipes.tipo_custo`. */
export type TipoCusto = 'sem_custo' | 'hora_extra' | 'diaria';

/**
 * Rótulo curto do tipo de custo, como sai na linha do membro no Anexo I.
 *
 * `Record<TipoCusto, …>` para que um tipo novo no union não passe daqui sem
 * rótulo. A ordem em que a TELA apresenta as três opções é da tela — o texto
 * dela é mais longo ("Hora extra (DRO)") porque o botão tem espaço, e o daqui
 * é o do documento, onde a coluna é estreita.
 */
export const ROTULO_TIPO_CUSTO: Record<TipoCusto, string> = {
	sem_custo: 'Sem custo',
	hora_extra: 'DRO (H. Extra)',
	diaria: 'Diária'
};

/** Título do bloco de horas extras no Anexo II, por extenso. */
export const TITULO_DRO = 'DIÁRIA DE REFORÇO OPERACIONAL (HORAS EXTRAS)';

/** Título do bloco de diárias no Anexo II. */
export const TITULO_DIARIAS = 'DIÁRIAS';

/**
 * O rótulo que vai na linha do membro: o tipo de custo, e — quando é diária —
 * qual delas, porque estadual e interestadual têm valores diferentes e o
 * documento precisa dizer qual foi aplicada.
 */
export function rotuloCustoDaEquipe(tipo: TipoCusto, diaria?: TipoDiaria | null): string {
	if (tipo === 'diaria' && diaria) return ROTULO_DIARIA[diaria];
	return ROTULO_TIPO_CUSTO[tipo];
}

/**
 * O resumo de horas do modelo: `6h (5N/1A)` — total, normais, acrescidas.
 *
 * "N" e "A" são a abreviação do documento (Normal / Acrescida). Devolve só
 * `6h` quando não há hora acrescida nenhuma, para não poluir a linha com
 * `(6N/0A)` — o modelo não imprime a decomposição quando ela é trivial.
 */
export function resumoHoras(normais: number, plus: number): string {
	const total = normais + plus;
	if (total <= 0) return '—';
	if (plus === 0) return `${total}h`;
	if (normais === 0) return `${total}h (${plus}A)`;
	return `${total}h (${normais}N/${plus}A)`;
}

/**
 * Valor em centavos formatado como moeda brasileira: `16380` → `R$ 163,80`.
 *
 * Entra INTEIRO e a divisão por 100 acontece só aqui, no último passo antes de
 * virar texto — é o que mantém o float fora de toda a cadeia de cálculo.
 * `Intl` não é usado de propósito: o Worker do Cloudflare tem ICU reduzida e o
 * separador sairia diferente do que a tela mostra em desenvolvimento.
 */
export function formatarBRL(centavos: number): string {
	const n = Math.round(centavos);
	const negativo = n < 0;
	const abs = Math.abs(n);
	const reais = Math.floor(abs / 100);
	const cents = abs % 100;
	// Milhar com ponto, na convenção brasileira.
	const inteiro = String(reais).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
	return `${negativo ? '-' : ''}R$ ${inteiro},${String(cents).padStart(2, '0')}`;
}

/**
 * O inverso: lê o valor digitado e devolve CENTAVOS inteiros, ou `null` quando
 * não é um valor monetário válido.
 *
 * Reconhece TRÊS FORMAS INTEIRAS, e recusa o resto — em vez de adivinhar o
 * separador pela posição. É o que torna a função previsível num campo em que
 * errar significa emitir documento com o valor errado:
 *
 * | forma       | exemplo    | por que existe                          |
 * | ----------- | ---------- | --------------------------------------- |
 * | brasileira  | `1.234,56` | o que o teclado brasileiro produz       |
 * | americana   | `1,234.56` | colado de planilha em locale en-US      |
 * | simples     | `27,30`    | sem agrupamento — a digitação do dia a dia |
 *
 * `1,2345` e `12.34.56` são recusados: não são valor em reais, e interpretá-los
 * seria inventar um número que ninguém digitou.
 *
 * **Nunca use `parseFloat` para dinheiro.** `parseFloat('27,30')` devolve 27 em
 * silêncio — os centavos somem e o total do documento sai errado sem nada
 * denunciar.
 */
export function lerBRL(entrada: string): number | null {
	const bruto = entrada.replace(/[R$\s\u00a0]/g, '');
	if (bruto === '') return null;

	const negativo = bruto.startsWith('-');
	const corpo = negativo ? bruto.slice(1) : bruto;

	// Testadas nesta ordem. A "simples" vem por último porque é a mais permissiva
	// e engoliria `1.234` como "um real e vinte e três" se viesse antes.
	const BRASILEIRA = /^(\d{1,3}(?:\.\d{3})+)(?:,(\d{1,2}))?$/;
	const AMERICANA = /^(\d{1,3}(?:,\d{3})+)(?:\.(\d{1,2}))?$/;
	const SIMPLES = /^(\d+)(?:[.,](\d{1,2}))?$/;

	let inteiro: string | undefined;
	let centavos = '0';

	for (const forma of [BRASILEIRA, AMERICANA, SIMPLES]) {
		const m = forma.exec(corpo);
		if (m) {
			inteiro = m[1].replace(/[.,]/g, '');
			centavos = m[2] ?? '0';
			break;
		}
	}
	if (inteiro === undefined) return null;

	// `padEnd`, não `padStart`: em `27,3` o 3 é DÉCIMO de real (30 centavos), não
	// 3 centavos. Trocar os dois divide o valor por dez sem erro nenhum.
	const total = Number(inteiro) * 100 + Number(centavos.padEnd(2, '0'));
	if (!Number.isSafeInteger(total)) return null;
	return negativo ? -total : total;
}
