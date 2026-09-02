/**
 * A UNIDADE em que a diária é contada — a meia diária — e sua formatação.
 *
 * Só a unidade. **Quem decide se a diária é devida, e quantas, é
 * `$lib/diarias/`**, que aplica o Decreto nº 35.922/2024. A separação é o que
 * o nome deste arquivo diz: aqui mora "3 meias se escrevem 1,5 diárias"; lá
 * mora "esta missão gera 3 meias".
 *
 * A corporação concede de meia diária a 15 diárias, em passos de meia. Guardar
 * isso como `2.5` num `real` colocaria float no caminho do dinheiro: o total do
 * Anexo II é `quantidade × valor`, e float acumula erro que aparece como um
 * centavo de diferença contra a planilha da corporação — num documento que
 * circula assinado, isso é o bastante para ele voltar.
 *
 * Por isso a unidade guardada é a MEIA DIÁRIA, inteira: `plano_equipes.
 * diarias_meias` vai de 1 a 30. Quem exibe divide por dois; quem calcula
 * multiplica pelo valor e divide por dois no fim, uma vez só
 * (ver `custoDeDiarias` em `custo.ts`).
 */

/** Mínimo concedido: meia diária. */
export const MIN_MEIAS = 1;

/** Máximo concedido: 15 diárias. */
export const MAX_MEIAS = 30;

/** Os dois tipos de diária. O valor de cada um está em `custo_parametros`. */
export type TipoDiaria = 'estadual' | 'interestadual';

/**
 * Rótulos na grafia do documento.
 *
 * É `Record<TipoDiaria, …>` de propósito: acrescentar um tipo de diária ao
 * union QUEBRA a compilação aqui, que é a exaustividade que interessa. Uma
 * lista ordenada dos tipos ao lado disto não acrescentaria garantia nenhuma —
 * seria uma segunda lista para manter em dia, e o `<select>` da tela, que é
 * quem escolhe a ordem, não a lia.
 */
export const ROTULO_DIARIA: Record<TipoDiaria, string> = {
	estadual: 'Diária estadual',
	interestadual: 'Diária interestadual'
};

/**
 * `true` se `n` é uma contagem de meias diárias concedível (inteiro de 1 a 30).
 *
 * Zero é FALSO aqui de propósito: equipe sem diária nenhuma não é equipe com
 * `tipo_custo = 'diaria'` e quantidade zero — é equipe `sem_custo`. Deixar o
 * zero passar produziria uma linha no Anexo II com "0 diárias — R$ 0,00", que
 * é ruído num documento orçamentário.
 */
export function meiasDiariasValidas(n: unknown): n is number {
	return typeof n === 'number' && Number.isInteger(n) && n >= MIN_MEIAS && n <= MAX_MEIAS;
}

/**
 * Converte meias diárias em diárias para EXIBIÇÃO (`3` → `1,5`).
 *
 * Privada: quem exibe chama `formatarDiarias`, que já devolve o texto pronto.
 * Publicar o número solto convidaria um call site a formatá-lo à mão e a
 * reintroduzir o float que este módulo existe para evitar.
 */
function meiasParaDiarias(meias: number): number {
	return meias / 2;
}

/**
 * Texto da quantidade, na convenção brasileira: `1` → "meia diária",
 * `2` → "1 diária", `3` → "1,5 diárias", `30` → "15 diárias".
 */
export function formatarDiarias(meias: number): string {
	if (!meiasDiariasValidas(meias)) return '—';
	if (meias === 1) return 'meia diária';
	if (meias === 2) return '1 diária';
	const valor = meiasParaDiarias(meias);
	// Inteiro sai sem casa decimal ("2 diárias"); meio sai com vírgula
	// ("1,5 diárias") — ponto decimal em documento em português lê como milhar.
	const txt = Number.isInteger(valor) ? String(valor) : valor.toFixed(1).replace('.', ',');
	return `${txt} diárias`;
}

/**
 * Lê a quantidade digitada em DIÁRIAS (`1,5` ou `1.5`) e devolve meias diárias,
 * ou `null` se não for uma quantidade concedível.
 *
 * Aceita vírgula porque é o que o teclado brasileiro produz. Rejeita passo
 * diferente de meia (`1,3`) em vez de arredondar: arredondar em silêncio
 * mudaria o valor pago sem o admin saber.
 */
export function lerDiarias(entrada: string): number | null {
	const txt = entrada.trim().replace(',', '.');
	if (txt === '') return null;
	const n = Number(txt);
	if (!Number.isFinite(n)) return null;
	const meias = n * 2;
	if (!Number.isInteger(meias)) return null;
	return meiasDiariasValidas(meias) ? meias : null;
}
