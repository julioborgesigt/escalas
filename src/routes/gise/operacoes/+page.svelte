<script lang="ts">
	/**
	 * Cadastro das operações extraordinárias (Admin Geral).
	 *
	 * A tela tem duas metades: o formulário de criação (com o "basear o formulário
	 * em", que é o ponto do pedido — não começar do zero) e a lista do que existe,
	 * com edição em linha.
	 *
	 * Não há botão de excluir, e isso é a regra, não um esquecimento: operação com
	 * escala histórica não pode sumir sem levar junto a origem de PDF já assinado.
	 * O que existe é desativar, e a contagem de escalas ao lado de cada operação é
	 * o que torna isso compreensível na hora.
	 */
	import type { PageProps } from './$types';
	import { enhance } from '$app/forms';
	import { loading } from '$lib/loading.svelte';
	import { toaster } from '$lib/toast';
	import { invalidate } from '$app/navigation';
	import BotaoVoltar from '$lib/components/BotaoVoltar.svelte';
	import Plus from '@lucide/svelte/icons/plus';
	import Power from '@lucide/svelte/icons/power';
	import SquarePen from '@lucide/svelte/icons/square-pen';
	import FileText from '@lucide/svelte/icons/file-text';
	import Sliders from '@lucide/svelte/icons/sliders-horizontal';

	const { data }: PageProps = $props();

	/** Id em edição, ou `null` — só uma linha aberta por vez. */
	let editando = $state<number | null>(null);
	let criando = $state(false);

	/** Operações que podem servir de base para o formulário da nova. */
	const baseaveis = $derived(data.operacoes);

	const CLASSE_CAMPO =
		'w-full min-w-0 px-3 py-2 rounded-xl border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-900 text-sm';

	/** Rótulo dos tipos de equipe da operação, para a coluna da lista. */
	function rotuloTipos(op: { usa_equipe_operacional: boolean; usa_equipe_seint: boolean }): string {
		const t: string[] = [];
		if (op.usa_equipe_operacional) t.push('Operacional');
		if (op.usa_equipe_seint) t.push('Inteligência (SEINT)');
		return t.join(' · ');
	}

	/** `use:enhance` comum às três actions: toast do erro do servidor e revalidação. */
	function enviar(mensagemOk: string, aoConcluir?: () => void) {
		return () => {
			loading.show('A gravar…');
			return async ({ result }: { result: { type: string; data?: unknown } }) => {
				loading.hide();
				if (result.type === 'success') {
					toaster.success({ title: mensagemOk });
					aoConcluir?.();
					await invalidate('app:operacoes');
				} else if (result.type === 'failure') {
					const err = (result.data as { error?: string } | undefined)?.error;
					toaster.error({ title: err || 'Não foi possível gravar' });
				}
			};
		};
	}
</script>

<svelte:head>
	<title>Operações | Escalas</title>
</svelte:head>

<div class="min-w-0 space-y-6">
	<BotaoVoltar href="/gise" />

	<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
		<div class="min-w-0">
			<h1 class="h1 text-2xl font-bold">Operações</h1>
			<p class="text-sm text-surface-600 dark:text-surface-400 mt-0.5">
				Cada operação tem o seu formulário de produtividade e os seus indicadores.
			</p>
		</div>
		<button
			type="button"
			class="btn preset-filled-primary-500 px-4 py-2.5 rounded-xl font-semibold shrink-0"
			onclick={() => (criando = !criando)}
		>
			<Plus class="w-4 h-4" />
			Nova operação
		</button>
	</div>

	{#if criando}
		<section class="card-elevated min-w-0 rounded-2xl p-5 sm:p-6 space-y-4">
			<h2 class="text-base font-semibold">Nova operação</h2>

			<form
				method="POST"
				action="?/criar"
				class="space-y-4"
				use:enhance={enviar('Operação criada', () => (criando = false))}
			>
				<div class="grid gap-4 sm:grid-cols-2">
					<div class="min-w-0">
						<label for="novo_nome" class="block text-sm font-medium mb-1">Nome *</label>
						<input
							id="novo_nome"
							name="nome"
							type="text"
							required
							maxlength="120"
							placeholder="OPERAÇÃO CRAJUBAR"
							class={CLASSE_CAMPO}
						/>
					</div>
					<div class="min-w-0">
						<label for="novo_sigla" class="block text-sm font-medium mb-1">Sigla</label>
						<input
							id="novo_sigla"
							name="sigla"
							type="text"
							maxlength="30"
							placeholder="CRAJUBAR"
							class={CLASSE_CAMPO}
						/>
						<p class="text-2xs text-surface-600 dark:text-surface-400 mt-1">
							Aparece nos filtros e no selo das escalas.
						</p>
					</div>
				</div>

				<div class="min-w-0">
					<label for="novo_desc" class="block text-sm font-medium mb-1">Descrição</label>
					<input id="novo_desc" name="descricao" type="text" maxlength="500" class={CLASSE_CAMPO} />
				</div>

				<div class="grid gap-4 sm:grid-cols-2">
					<div class="min-w-0">
						<label for="novo_ini" class="block text-sm font-medium mb-1">Início do ciclo</label>
						<input id="novo_ini" name="data_inicio" type="date" class={CLASSE_CAMPO} />
					</div>
					<div class="min-w-0">
						<label for="novo_fim" class="block text-sm font-medium mb-1">Fim do ciclo</label>
						<input id="novo_fim" name="data_fim" type="date" class={CLASSE_CAMPO} />
					</div>
				</div>

				<fieldset
					class="rounded-xl border border-surface-200/70 bg-surface-50 dark:border-white/10 dark:bg-surface-800/40 p-4 space-y-2"
				>
					<legend class="text-sm font-semibold px-1">Tipos de equipe</legend>
					<p class="text-2xs text-surface-600 dark:text-surface-400">
						A operação só oferece os tipos marcados, e terá um formulário para cada um.
					</p>
					<label class="flex items-center gap-2 text-sm">
						<input type="checkbox" name="usa_operacional" checked class="checkbox" />
						Operacional
					</label>
					<label class="flex items-center gap-2 text-sm">
						<input type="checkbox" name="usa_seint" checked class="checkbox" />
						Inteligência (SEINT)
					</label>
				</fieldset>

				<div class="min-w-0">
					<label for="novo_base" class="block text-sm font-medium mb-1">
						Basear o formulário em
					</label>
					<select id="novo_base" name="basear_em" class={CLASSE_CAMPO}>
						<option value="">Começar em branco (formulário padrão)</option>
						{#each baseaveis as op (op.id)}
							<option value={op.id}>{op.nome}</option>
						{/each}
					</select>
					<p class="text-2xs text-surface-600 dark:text-surface-400 mt-1">
						Copia as perguntas da operação escolhida para editar a partir delas, em vez de montar o
						formulário do zero. Só os tipos de equipe marcados acima são copiados.
					</p>
				</div>

				<div class="flex justify-end gap-2 pt-2">
					<button
						type="button"
						class="btn preset-outlined-surface-500 px-4 py-2.5 rounded-xl"
						onclick={() => (criando = false)}
					>
						Cancelar
					</button>
					<button
						type="submit"
						class="btn preset-filled-primary-500 px-6 py-2.5 rounded-xl font-semibold"
						disabled={loading.active}
					>
						Criar operação
					</button>
				</div>
			</form>
		</section>
	{/if}

	<section class="card-elevated min-w-0 rounded-2xl p-5 sm:p-6 space-y-3">
		<h2 class="text-base font-semibold">Operações cadastradas</h2>

		{#if data.operacoes.length === 0}
			<p class="text-sm text-surface-600 dark:text-surface-400">Nenhuma operação cadastrada.</p>
		{:else}
			<ul class="space-y-3">
				{#each data.operacoes as op (op.id)}
					<li
						class="rounded-xl border border-surface-200/70 dark:border-white/10 p-4 space-y-3"
						class:opacity-60={!op.ativo}
					>
						<div class="flex flex-wrap items-start justify-between gap-3">
							<div class="min-w-0">
								<div class="flex flex-wrap items-center gap-2">
									<span class="font-semibold">{op.nome}</span>
									{#if op.sigla}
										<span
											class="rounded-full bg-primary-500/10 text-primary-700 dark:text-primary-300 px-2 py-0.5 text-2xs font-semibold"
										>
											{op.sigla}
										</span>
									{/if}
									{#if !op.ativo}
										<span
											class="rounded-full bg-surface-500/15 px-2 py-0.5 text-2xs font-semibold text-surface-600 dark:text-surface-400"
										>
											Desativada
										</span>
									{/if}
								</div>
								<p class="text-2xs text-surface-600 dark:text-surface-400 mt-1">
									{rotuloTipos(op)}
									·
									{op.escalas === 1 ? '1 escala' : `${op.escalas} escalas`}
									{#if op.data_inicio || op.data_fim}
										· ciclo {op.data_inicio ?? '…'} a {op.data_fim ?? '…'}
									{/if}
								</p>
								{#if op.descricao}
									<p class="text-2xs text-surface-600 dark:text-surface-400 mt-1">
										{op.descricao}
									</p>
								{/if}
							</div>

							<div class="flex flex-wrap items-center gap-2 shrink-0">
								<a
									href={`/res-gise?operacaoId=${op.id}`}
									class="btn preset-outlined-surface-500 px-3 py-1.5 rounded-xl text-sm"
								>
									<FileText class="w-4 h-4" />
									Formulário
								</a>
								<a
									href={`/gise/operacoes/${op.id}/config`}
									class="btn preset-outlined-surface-500 px-3 py-1.5 rounded-xl text-sm"
								>
									<Sliders class="w-4 h-4" />
									Configurações
								</a>
								<button
									type="button"
									class="btn preset-outlined-surface-500 px-3 py-1.5 rounded-xl text-sm"
									onclick={() => (editando = editando === op.id ? null : op.id)}
								>
									<SquarePen class="w-4 h-4" />
									Editar
								</button>
								<form
									method="POST"
									action="?/alternarAtivo"
									use:enhance={enviar(op.ativo ? 'Operação desativada' : 'Operação reativada')}
								>
									<input type="hidden" name="id" value={op.id} />
									<button
										type="submit"
										class="btn preset-outlined-surface-500 px-3 py-1.5 rounded-xl text-sm"
										disabled={loading.active}
									>
										<Power class="w-4 h-4" />
										{op.ativo ? 'Desativar' : 'Reativar'}
									</button>
								</form>
							</div>
						</div>

						{#if editando === op.id}
							<form
								method="POST"
								action="?/editar"
								class="border-t border-surface-200 dark:border-white/10 pt-3 space-y-3"
								use:enhance={enviar('Operação salva', () => (editando = null))}
							>
								<input type="hidden" name="id" value={op.id} />
								<div class="grid gap-3 sm:grid-cols-2">
									<div class="min-w-0">
										<label for={`n_${op.id}`} class="block text-sm font-medium mb-1">Nome *</label>
										<input
											id={`n_${op.id}`}
											name="nome"
											type="text"
											required
											maxlength="120"
											value={op.nome}
											class={CLASSE_CAMPO}
										/>
									</div>
									<div class="min-w-0">
										<label for={`s_${op.id}`} class="block text-sm font-medium mb-1">Sigla</label>
										<input
											id={`s_${op.id}`}
											name="sigla"
											type="text"
											maxlength="30"
											value={op.sigla}
											class={CLASSE_CAMPO}
										/>
									</div>
								</div>
								<div class="min-w-0">
									<label for={`d_${op.id}`} class="block text-sm font-medium mb-1">Descrição</label>
									<input
										id={`d_${op.id}`}
										name="descricao"
										type="text"
										maxlength="500"
										value={op.descricao}
										class={CLASSE_CAMPO}
									/>
								</div>
								<div class="grid gap-3 sm:grid-cols-2">
									<div class="min-w-0">
										<label for={`i_${op.id}`} class="block text-sm font-medium mb-1">
											Início do ciclo
										</label>
										<input
											id={`i_${op.id}`}
											name="data_inicio"
											type="date"
											value={op.data_inicio ?? ''}
											class={CLASSE_CAMPO}
										/>
									</div>
									<div class="min-w-0">
										<label for={`f_${op.id}`} class="block text-sm font-medium mb-1">
											Fim do ciclo
										</label>
										<input
											id={`f_${op.id}`}
											name="data_fim"
											type="date"
											value={op.data_fim ?? ''}
											class={CLASSE_CAMPO}
										/>
									</div>
								</div>
								<fieldset class="space-y-2">
									<legend class="text-sm font-semibold">Tipos de equipe</legend>
									<label class="flex items-center gap-2 text-sm">
										<input
											type="checkbox"
											name="usa_operacional"
											checked={op.usa_equipe_operacional}
											class="checkbox"
										/>
										Operacional
									</label>
									<label class="flex items-center gap-2 text-sm">
										<input
											type="checkbox"
											name="usa_seint"
											checked={op.usa_equipe_seint}
											class="checkbox"
										/>
										Inteligência (SEINT)
									</label>
									<p class="text-2xs text-surface-600 dark:text-surface-400">
										Desmarcar um tipo não mexe nas escalas já montadas — só impede novas equipes
										daquele tipo.
									</p>
								</fieldset>
								<div class="flex justify-end gap-2">
									<button
										type="button"
										class="btn preset-outlined-surface-500 px-4 py-2 rounded-xl text-sm"
										onclick={() => (editando = null)}
									>
										Cancelar
									</button>
									<button
										type="submit"
										class="btn preset-filled-primary-500 px-4 py-2 rounded-xl text-sm font-semibold"
										disabled={loading.active}
									>
										Salvar
									</button>
								</div>
							</form>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</section>
</div>
