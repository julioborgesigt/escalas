<script lang="ts">
	/**
	 * A lista de opções de um tipo (briefing ou destino), com a PADRÃO marcada.
	 *
	 * Duas instâncias na tela, uma por tipo — são a mesma forma, então é um
	 * componente com `tipo` em vez de dois quase iguais que divergiriam na
	 * primeira correção.
	 *
	 * A estrela é a mesma metáfora do chefe de equipe, e por baixo é o mesmo
	 * mecanismo: índice único parcial. Marcar outra não pede confirmação porque
	 * o efeito é visível na hora e reversível com um clique.
	 *
	 * ## As opções ficam FORA do formulário de parâmetros
	 *
	 * Cada uma grava sozinha, como os membros da equipe. Se dependessem do
	 * "Salvar parâmetros", acrescentar um destino exigiria salvar o plano
	 * inteiro — e quem só queria a opção nova levaria junto qualquer edição pela
	 * metade que estivesse nos outros campos.
	 */
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { PlanoOpcao } from '$lib/server/schema';
	import { loading } from '$lib/loading.svelte';
	import Star from '@lucide/svelte/icons/star';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Plus from '@lucide/svelte/icons/plus';

	const {
		tipo,
		rotulo,
		descricao,
		exemplo,
		opcoes,
		enviar
	}: {
		tipo: 'briefing' | 'destino';
		rotulo: string;
		descricao: string;
		/** Placeholder do campo de acrescentar — um exemplo real, não "digite aqui". */
		exemplo: string;
		opcoes: PlanoOpcao[];
		/** `use:enhance` comum, vindo da página. */
		enviar: (msg: string, aoConcluir?: () => void) => SubmitFunction;
	} = $props();

	let novo = $state('');

	/**
	 * Lista COM opções e SEM nenhuma padrão — o estado em que os planos antigos
	 * chegaram da migração, que semeou as cidades de destino das equipes sem
	 * eleger uma (qual delas seria não está em lugar nenhum do banco).
	 *
	 * Precisa estar escrito: sem estrela nenhuma a equipe nova nasce com o campo
	 * em branco, e a lista cheia logo acima sugere exatamente o contrário.
	 */
	const semPadrao = $derived(opcoes.length > 0 && !opcoes.some((o) => o.padrao));
</script>

<div class="space-y-2">
	<div>
		<span class="block text-xs font-medium text-surface-700 dark:text-surface-200">{rotulo}</span>
		<span class="block text-2xs text-surface-600 dark:text-surface-400">{descricao}</span>
	</div>

	{#if opcoes.length > 0}
		<ul class="space-y-1.5">
			{#each opcoes as o (o.id)}
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
						{#if !o.padrao}
							<form
								method="POST"
								action="?/definirOpcaoPadrao"
								use:enhance={enviar('Opção padrão definida')}
								class="contents"
							>
								<input type="hidden" name="opcao_id" value={o.id} />
								<button
									type="submit"
									class="btn btn-sm preset-outlined-surface-500 px-2 py-1 rounded-lg text-3xs"
									title="Usar como padrão nas equipes novas"
									disabled={loading.active}
								>
									<Star class="w-3 h-3" />
									Padrão
								</button>
							</form>
						{/if}
						<form
							method="POST"
							action="?/removerOpcao"
							use:enhance={enviar('Opção removida')}
							class="contents"
						>
							<input type="hidden" name="opcao_id" value={o.id} />
							<button
								type="submit"
								class="btn btn-sm preset-outlined-surface-500 px-2 py-1 rounded-lg text-3xs"
								title="Remover da lista"
								disabled={loading.active}
							>
								<Trash2 class="w-3 h-3" />
							</button>
						</form>
					</div>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="text-2xs text-surface-600 dark:text-surface-400">
			Nenhuma opção cadastrada — as equipes nascem com este campo em branco.
		</p>
	{/if}

	{#if semPadrao}
		<p class="text-2xs text-warning-700 dark:text-warning-400">
			Nenhuma marcada como padrão — as equipes novas continuam nascendo com este campo em branco.
			Use o botão <strong>Padrão</strong> em uma delas.
		</p>
	{/if}

	<form
		method="POST"
		action="?/adicionarOpcao"
		use:enhance={enviar('Opção acrescentada', () => (novo = ''))}
		class="flex gap-2"
	>
		<input type="hidden" name="tipo" value={tipo} />
		<input
			name="valor"
			bind:value={novo}
			maxlength="200"
			placeholder={exemplo}
			class="input flex-1 min-w-0"
		/>
		<button
			type="submit"
			class="btn preset-outlined-surface-500 py-2 px-3 rounded-xl text-xs shrink-0"
			disabled={loading.active || !novo.trim()}
		>
			<Plus class="w-3.5 h-3.5" />
			Acrescentar
		</button>
	</form>
</div>
