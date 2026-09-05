<script lang="ts">
	/**
	 * Card clicável que abre e fecha — a versão MOBILE da linha das duas tabelas
	 * do console de auditoria / logs técnicos.
	 *
	 * Extraído porque o que se repetia não era o visual, e sim a ACESSIBILIDADE:
	 * `role`, `tabindex`, `aria-expanded` e o handler que faz Enter e Espaço
	 * valerem o mesmo que o clique. Duplicada, é o tipo de mecânica que diverge
	 * sem ninguém ver — a tela que perder o `onkeydown` continua parecendo certa
	 * e deixa de ser operável por teclado.
	 *
	 * Só a casca é comum: o conteúdo de cada linha (evento de auditoria × registro
	 * técnico) entra pelo snippet e não tem nada em comum entre as duas.
	 */
	import type { Snippet } from 'svelte';

	const {
		aberto,
		onalternar,
		children
	}: {
		/** Estado atual, para o `aria-expanded` — quem guarda é o chamador. */
		aberto: boolean;
		/** Alterna o estado. Chamado pelo clique e pelas duas teclas. */
		onalternar: () => void;
		children: Snippet;
	} = $props();
</script>

<div
	class="rounded-xl card-elevated p-4 space-y-3 cursor-pointer transition-colors active:bg-surface-100 dark:active:bg-surface-800/40"
	role="button"
	tabindex="0"
	aria-expanded={aberto}
	onclick={onalternar}
	onkeydown={(e) => {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			onalternar();
		}
	}}
>
	{@render children()}
</div>
