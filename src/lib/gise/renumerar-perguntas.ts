/**
 * Renumeração dos rótulos do formulário de produtividade após reordenar ou
 * remover perguntas.
 *
 * O número da pergunta NÃO é um campo: ele é parte do texto que o admin
 * escreveu (`"4. Houve PROCEDIMENTO em flagrante realizado?"`), e se repete nos
 * sub-rótulos do mesmo bloco (`"4.1 QUANTIDADE:"`, `"4.2 INFORMAR NOMES E
 * PROCEDIMENTOS:"`). O badge cinza do editor é derivado da posição e se acerta
 * sozinho — o texto, que é o que o policial lê e o que sai no relatório, não.
 * Sem esta função, arrastar a pergunta 4 para o fim deixaria um "4." na
 * posição 8.
 *
 * ## O que é e o que não é mexido
 *
 * Só o PRIMEIRO segmento numérico, e só quando ele é seguido de ponto:
 *
 * - `"4. Houve..."` → `"8. Houve..."`
 * - `"4.1 QUANTIDADE:"` → `"8.1 QUANTIDADE:"` (o `.1` é a ordem DENTRO do bloco)
 * - `"10.1.1 PESOS:"` → `"8.1.1 PESOS:"`
 * - `"Quantos?"` → intocado (não começa com número)
 * - `"2026 foi o ano..."` → intocado (número sem ponto — a convenção da casa é
 *   `"N. texto"`, e exigir o ponto evita reescrever prosa por engano)
 *
 * Os FILHOS herdam o número do pai pelo mesmo critério: a sub-pergunta rotulada
 * `"4.3 ..."` acompanha o bloco. Filho sem número (o caso comum, `"Quantos?"`)
 * não é tocado.
 *
 * A renumeração é IDEMPOTENTE — aplicá-la de novo sobre a saída não muda nada.
 */
import type { GiseModeloPerguntaConfig } from '$lib/types';

/** Campos de rótulo que carregam a numeração do bloco. */
const CAMPOS_SUBTEXTO = [
	'subtexto_qtd',
	'subtexto_lista',
	'subtexto_tipo',
	'subtexto_detalhe'
] as const;

/**
 * Troca o primeiro segmento numérico do rótulo, preservando o resto.
 * Devolve o texto original quando ele não começa com `número + ponto`.
 */
function trocarNumero(texto: string | undefined, numero: number): string | undefined {
	if (!texto) return texto;
	return texto.replace(/^(\s*)\d+(?=\.)/, `$1${numero}`);
}

/** Aplica `trocarNumero` no texto e em todos os sub-rótulos da pergunta. */
function renumerarUma(p: GiseModeloPerguntaConfig, numero: number): GiseModeloPerguntaConfig {
	const renumerada: GiseModeloPerguntaConfig = { ...p, texto: trocarNumero(p.texto, numero) ?? '' };
	for (const campo of CAMPOS_SUBTEXTO) {
		if (renumerada[campo] !== undefined) {
			renumerada[campo] = trocarNumero(renumerada[campo], numero);
		}
	}
	if (p.filhos?.length) {
		renumerada.filhos = p.filhos.map((f) => renumerarUma(f, numero));
	}
	return renumerada;
}

/**
 * Devolve a lista com os rótulos renumerados pela POSIÇÃO atual (1-based).
 *
 * Não muta a entrada: o editor troca a referência inteira, que é o que faz o
 * `$state` do Svelte reagir. Nada disso é gravado até o admin clicar em Salvar,
 * então uma renumeração indesejada se desfaz saindo da tela.
 */
export function renumerarPerguntas(
	perguntas: GiseModeloPerguntaConfig[]
): GiseModeloPerguntaConfig[] {
	return perguntas.map((p, i) => renumerarUma(p, i + 1));
}
