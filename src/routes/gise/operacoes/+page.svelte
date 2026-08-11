<script lang="ts">
	/**
	 * Cadastro das operações extraordinárias (Admin Geral).
	 *
	 * ## Duas telas, um slide
	 *
	 * A lista e o formulário são painéis do MESMO slider horizontal — o mesmo
	 * desenho do fluxo de presença em `/res-gise`. Antes o formulário de criação
	 * abria empurrando a lista para baixo, e o de edição abria dentro da linha:
	 * três coisas competindo pela mesma tela, e um formulário longo espremido
	 * entre elas.
	 *
	 * O painel aberto vive na URL (`?form=nova` ou `?form=<id>`), não num `$state`
	 * local. É o que faz o botão "voltar" do navegador desfazer a abertura, o que
	 * mantém o link de edição compartilhável e o que permite
	 * `/gise/operacoes/[id]/config` redirecionar para o painel certo.
	 *
	 * O botão **Dados base** aparece só na linha da operação que tem indicador
	 * PERCENTUAL — é o único tipo de meta que pede um valor inicial à delegacia.
	 * Ele leva a `/dados-base/<id>`, com a operação no caminho: a tela de
	 * preenchimento não tem seletor, e não há como digitar o acervo de uma
	 * delegacia sob a operação errada.
	 *
	 * Não há botão de excluir, e isso é a regra, não um esquecimento: operação com
	 * escala histórica não pode sumir sem levar junto a origem de PDF já assinado.
	 * O que existe é desativar, e a contagem de escalas ao lado de cada operação é
	 * o que torna isso compreensível na hora.
	 */
	import type { PageProps } from './$types';
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { goto, invalidate } from '$app/navigation';
	import { loading } from '$lib/loading.svelte';
	import { toaster } from '$lib/toast';
	import BotaoVoltar from '$lib/components/BotaoVoltar.svelte';
	import FormularioOperacao from './_components/FormularioOperacao.svelte';
	import Plus from '@lucide/svelte/icons/plus';
	import Power from '@lucide/svelte/icons/power';
	import SquarePen from '@lucide/svelte/icons/square-pen';
	import FileText from '@lucide/svelte/icons/file-text';
	import ClipboardCheck from '@lucide/svelte/icons/clipboard-check';

	const { data }: PageProps = $props();

	/**
	 * Qual painel está aberto, lido da URL.
	 *
	 * `'nova'` cria; um número edita aquela operação; `null` mostra a lista. Um id
	 * que não existe mais (operação removida noutra aba, link velho) cai em `null`
	 * em vez de abrir um formulário vazio — a lista é o estado sempre válido.
	 */
	const paramForm = $derived(page.url.searchParams.get('form'));
	const criando = $derived(paramForm === 'nova');
	const emEdicao = $derived(
		paramForm && paramForm !== 'nova'
			? (data.operacoes.find((o) => o.id === Number(paramForm)) ?? null)
			: null
	);
	const painelAberto = $derived(criando || emEdicao !== null);

	function abrir(alvo: string) {
		goto(`?form=${alvo}`, { keepFocus: true, noScroll: true });
		window.scrollTo({ top: 0, behavior: 'smooth' });
	}

	function voltarParaLista() {
		goto(page.url.pathname, { keepFocus: true, noScroll: true });
		window.scrollTo({ top: 0, behavior: 'smooth' });
	}

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
					await invalidate('app:operacoes');
					aoConcluir?.();
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

<!-- Slide lateral: o container esconde o painel que está fora de tela. -->
<div class="min-w-0 overflow-hidden">
	<div
		class="flex transition-transform duration-300 ease-in-out"
		style="transform: translateX({painelAberto ? '-50%' : '0%'}); width: 200%;"
	>
		<!-- Painel 1: a lista -->
		<div class="min-w-0 space-y-6 px-1" style="width: 50%;">
			<BotaoVoltar href="/gise" />

			<div class="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
				<div class="min-w-0">
					<h1 class="h1 text-2xl font-bold">Operações</h1>
					<p class="text-sm text-surface-600 dark:text-surface-400 mt-0.5">
						Cada operação tem o seu formulário de produtividade e os seus indicadores.
					</p>
				</div>
				<button
					type="button"
					class="btn preset-filled-primary-500 px-4 py-2.5 rounded-xl font-semibold shrink-0"
					onclick={() => abrir('nova')}
				>
					<Plus class="w-4 h-4" />
					Nova operação
				</button>
			</div>

			<section class="card-elevated min-w-0 rounded-2xl p-5 sm:p-6 space-y-3">
				<h2 class="text-base font-semibold">Operações cadastradas</h2>

				{#if data.operacoes.length === 0}
					<p class="text-sm text-surface-600 dark:text-surface-400">Nenhuma operação cadastrada.</p>
				{:else}
					<ul class="space-y-3">
						{#each data.operacoes as op (op.id)}
							<li
								class="rounded-xl border border-surface-200/70 dark:border-white/10 p-4"
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

									<!-- Três botões, e não quatro: "Configurações" virou parte de
									     "Editar" — as duas metades descrevem a mesma operação. -->
									<div class="flex flex-wrap items-center gap-2 shrink-0">
										<a
											href={`/res-gise?operacaoId=${op.id}`}
											class="btn preset-outlined-surface-500 px-3 py-1.5 rounded-xl text-sm"
										>
											<FileText class="w-4 h-4" />
											Formulário
										</a>
										<!-- Só na operação que PEDE base: das três cadastradas, só a
										     que tem indicador percentual tem o que perguntar às
										     delegacias. Um botão no cabeçalho sugeria que era trabalho
										     de todas. O link leva à operação, não à tela genérica. -->
										{#if op.pedeLinhaBase}
											<a
												href={`/dados-base/${op.id}`}
												class="btn preset-outlined-surface-500 px-3 py-1.5 rounded-xl text-sm"
											>
												<ClipboardCheck class="w-4 h-4" />
												Dados base
											</a>
										{/if}
										<button
											type="button"
											class="btn preset-outlined-surface-500 px-3 py-1.5 rounded-xl text-sm"
											onclick={() => abrir(String(op.id))}
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
							</li>
						{/each}
					</ul>
				{/if}
			</section>
		</div>

		<!-- Painel 2: o formulário, sozinho na tela.

		     `{#key}` remonta o componente ao trocar de operação: os campos são
		     `value=` não-controlado (para o navegador poder restaurar o que o admin
		     digitou), então sem a remontagem passar de uma linha a outra manteria o
		     texto da anterior. -->
		<div class="min-w-0 px-1" style="width: 50%;">
			{#if painelAberto}
				{#key paramForm}
					<FormularioOperacao
						operacao={emEdicao}
						herdado={data.herdado}
						baseaveis={data.operacoes}
						aoVoltar={voltarParaLista}
						{enviar}
					/>
				{/key}
			{/if}
		</div>
	</div>
</div>
