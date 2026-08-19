<script lang="ts">
	/**
	 * Uma linha do laudo de `/validar/[hash]` — ícone + texto, com o pareamento
	 * ícone × cor fixado por ESTADO.
	 *
	 * Esta é a tela PÚBLICA: é onde o cidadão confere um documento assinado. As
	 * nove linhas do laudo (integridade, cadeia ICP, RSA, carimbo, política,
	 * revogação, selo institucional, carimbo do selo) diziam a mesma coisa em
	 * markup independente, e a apresentação já tinha divergido em dois pontos:
	 *
	 *   - "Cadeia ICP-Brasil não validada (trust store não populado)" usava
	 *     `AlertTriangle` + texto itálico, enquanto "verificação de integridade
	 *     indisponível" e "OCSP indisponível" — o MESMO sentido, "não deu para
	 *     verificar" — usavam `HelpCircle` + itálico. O itálico já classificava
	 *     as três como indisponíveis; só o ícone discordava;
	 *   - a ressalva de TSA externa vinha em `text-surface-700` e as demais
	 *     ressalvas em `text-surface-600`.
	 *
	 * Aqui os dois viraram `indisponivel` e `ressalva`, respectivamente. É uma
	 * normalização DELIBERADA, não um efeito colateral: num laudo, dois símbolos
	 * para a mesma conclusão sugerem gravidades diferentes onde não há.
	 *
	 * O ganho maior é a próxima verificação: um décimo item nasce com a
	 * apresentação dos outros nove, e o autor escolhe entre quatro estados em
	 * vez de copiar a linha vizinha e ajustar classes.
	 */
	import type { Snippet } from 'svelte';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import Check from '@lucide/svelte/icons/check';
	import HelpCircle from '@lucide/svelte/icons/help-circle';
	import X from '@lucide/svelte/icons/x';

	/**
	 * - `ok` — a verificação passou;
	 * - `ressalva` — passou, mas com menos garantia do que o ideal (TSA não-ICP,
	 *   política ausente). NÃO é falha: o documento continua válido;
	 * - `indisponivel` — não foi possível verificar (registro antigo, trust store
	 *   vazio). Não afirma nada sobre o documento;
	 * - `falha` — a verificação REPROVOU. É a única que acusa o documento.
	 */
	export type EstadoVeredito = 'ok' | 'ressalva' | 'indisponivel' | 'falha';

	const { estado, children }: { estado: EstadoVeredito; children: Snippet } = $props();

	const ICONE = {
		ok: Check,
		ressalva: AlertTriangle,
		indisponivel: HelpCircle,
		falha: X
	} as const;

	const CLASSE_ICONE = {
		ok: 'text-success-600',
		ressalva: 'text-warning-600',
		indisponivel: 'text-surface-400',
		falha: 'text-error-600'
	} as const;

	const CLASSE_TEXTO = {
		ok: 'text-surface-700 dark:text-surface-300',
		ressalva: 'text-surface-600 dark:text-surface-400',
		indisponivel: 'text-surface-600 dark:text-surface-400 italic',
		falha: 'text-error-700 dark:text-error-400 font-bold'
	} as const;

	const Icone = $derived(ICONE[estado]);
</script>

<div class="flex items-start gap-2">
	<Icone class="w-4 h-4 shrink-0 mt-0.5 {CLASSE_ICONE[estado]}" aria-hidden="true" />
	<span class={CLASSE_TEXTO[estado]}>{@render children()}</span>
</div>
