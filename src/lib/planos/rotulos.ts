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

/** Os três, na ordem em que a UI os apresenta. */
export const TIPOS_CUSTO: readonly TipoCusto[] = ['sem_custo', 'hora_extra', 'diaria'];

/** Rótulo curto do tipo de custo, como sai na linha do membro no Anexo I. */
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
