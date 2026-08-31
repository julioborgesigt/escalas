<script lang="ts">
	/**
	 * A LISTA de opções de um tipo, com a padrão marcada por estrela.
	 *
	 * Só a apresentação. Quem grava é quem usa, e as duas telas gravam de formas
	 * incompatíveis:
	 *
	 * - no EDITOR (`[id]/_components/EditorOpcoes.svelte`) cada mexida é uma form
	 *   action, porque o plano existe e a opção tem `id` no banco;
	 * - na CRIAÇÃO (`novo/+page.svelte`) o plano ainda não existe, então a lista
	 *   é estado local e viaja como array no `FormData` do "Criar plano".
	 *
	 * Extrair só o desenho é o meio-termo que o `CLAUDE.md` pede: o visual não
	 * pode divergir entre as duas telas (é a mesma lista, com a mesma estrela e o
	 * mesmo aviso), e forçar um mecanismo único de gravação exigiria ou criar o
	 * plano antes da hora, ou fazer a opção do editor esperar por um "salvar"
	 * que ela não tem hoje.
	 *
	 * As AÇÕES de cada linha vêm por snippet justamente por isso: o editor passa
	 * dois `<form>`, a criação passa dois `<button>`.
	 */
	import type { Snippet } from 'svelte';
	import Star from '@lucide/svelte/icons/star';
	import Plus from '@lucide/svelte/icons/plus';

	/** O mínimo que a lista precisa de cada opção para desenhá-la. */
	export type OpcaoNaLista = {
		/** Identificador estável para a `{#each}` — o `id` do banco ou o próprio valor. */
		chave: string | number;
		valor: string;
		padrao: boolean;
	};

	const {
		rotulo,
		descricao,
		exemplo,
		opcoes,
		acoes,
		aoAcrescentar,
		ocupado = false
	}: {
		rotulo: string;
		descricao: string;
		/** Placeholder do campo — um exemplo real, não "digite aqui". */
		exemplo: string;
		opcoes: OpcaoNaLista[];
		/** Os botões de cada linha: `<form>` no editor, `<button>` na criação. */
		acoes: Snippet<[OpcaoNaLista]>;
		aoAcrescentar: (valor: string) => void;
		ocupado?: boolean;
	} = $props();

	let novo = $state('');

	/**
	 * Lista COM opções e SEM nenhuma padrão.
	 *
	 * Precisa estar escrito: sem estrela nenhuma a equipe nova nasce com o campo
	 * em branco, e a lista cheia logo acima sugere exatamente o contrário.
	 */
	const semPadrao = $derived(opcoes.length > 0 && !opcoes.some((o) => o.padrao));

	function acrescentar() {
		const v = novo.trim();
		if (!v) return;
		aoAcrescentar(v);
		novo = '';
	}
</script>

<div class="space-y-2">
	<div>
		<span class="block text-sm font-medium text-surface-700 dark:text-surface-200">{rotulo}</span>
		<span class="block text-xs text-surface-600 dark:text-surface-400">{descricao}</span>
	</div>

	{#if opcoes.length > 0}
		<ul class="space-y-1.5">
			{#each opcoes as o (o.chave)}
				<li
					class="flex items-center gap-2 rounded-lg border p-2 {o.padrao
						? 'border-primary-500/40 bg-primary-500/5'
						: 'border-surface-200/70 dark:border-white/10'}"
				>
					{#if o.padrao}
						<Star
							class="w-3.5 h-3.5 shrink-0 text-warning-600 dark:text-warning-400"
							aria-label="Opção padrão"
						/>
					{/if}
					<span class="min-w-0 flex-1 truncate text-sm text-surface-900 dark:text-white">
						{o.valor}
					</span>

					<div class="flex gap-1.5 shrink-0">
						{@render acoes(o)}
					</div>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="text-xs text-surface-600 dark:text-surface-400">
			Nenhuma opção cadastrada — as equipes nascem com este campo em branco.
		</p>
	{/if}

	{#if semPadrao}
		<p class="text-xs text-warning-700 dark:text-warning-400">
			Nenhuma marcada como padrão — as equipes novas continuam nascendo com este campo em branco.
			Use o botão <strong>Padrão</strong> em uma delas.
		</p>
	{/if}

	<!-- `type="button"`: na criação este bloco vive DENTRO do formulário que cria
	     o plano, e um submit aqui enviaria o plano pela metade ao acrescentar uma
	     cidade. O Enter no campo é interceptado pelo mesmo motivo. -->
	<div class="flex gap-2">
		<input
			bind:value={novo}
			maxlength="200"
			placeholder={exemplo}
			class="input flex-1 min-w-0"
			onkeydown={(e) => {
				if (e.key === 'Enter') {
					e.preventDefault();
					acrescentar();
				}
			}}
		/>
		<button
			type="button"
			class="btn preset-outlined-surface-500 py-2 px-3 rounded-xl text-sm shrink-0"
			disabled={ocupado || !novo.trim()}
			onclick={acrescentar}
		>
			<Plus class="w-4 h-4" />
			Acrescentar
		</button>
	</div>
</div>
