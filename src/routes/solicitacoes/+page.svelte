<script lang="ts">
	/**
	 * Fila de aprovação das alterações cadastrais pedidas em "Meu perfil"
	 * (`/solicitacoes`, Admin Geral). Aprovar grava o novo valor no cadastro na
	 * hora; rejeitar apenas encerra a solicitação.
	 */
	import type { PageProps } from './$types';
	import { enhance } from '$app/forms';
	import { toaster } from '$lib/toast';
	import { ROTULO_CAMPO } from '$lib/perfil-campos';
	import type { ActionResult } from '@sveltejs/kit';

	const { data }: PageProps = $props();

	// Derivado gravável: espelha o load, mas admite a atualização otimista local.
	let pendentes = $derived(data.pendentes);

	let decidindoId = $state<number | null>(null);

	/**
	 * A action devolve a lista já sem o item decidido — usar essa resposta evita
	 * um `invalidateAll()` (e o piscar da tabela) a cada decisão.
	 */
	function handleDecidir(id: number, decisao: 'aprovar' | 'rejeitar') {
		decidindoId = id;
		return async ({ result }: { result: ActionResult }) => {
			decidindoId = null;
			if (result.type === 'success') {
				pendentes = (result.data?.pendentes as typeof pendentes) ?? pendentes;
				toaster.create({
					title: decisao === 'aprovar' ? 'Alteração aprovada e aplicada' : 'Solicitação rejeitada',
					type: decisao === 'aprovar' ? 'success' : 'info'
				});
			} else if (result.type === 'error') {
				toaster.create({ title: 'Erro de conexão. Tente novamente.', type: 'error' });
			} else {
				const d =
					result.type === 'failure'
						? (result.data as Record<string, unknown> | undefined)
						: undefined;
				toaster.create({ title: String(d?.error || 'Erro ao decidir'), type: 'error' });
			}
		};
	}
</script>

<svelte:head><title>Solicitações</title></svelte:head>

<div class="max-w-5xl mx-auto space-y-6">
	<div>
		<h1 class="h2 font-bold">Solicitações</h1>
		<p class="text-sm text-surface-600 dark:text-surface-400 mt-1">
			Alterações cadastrais pedidas pelos servidores no "Meu perfil". Aprovar aplica o novo valor
			imediatamente no cadastro.
		</p>
	</div>

	{#if pendentes.length === 0}
		<div class="card-glass p-10 rounded-3xl text-center text-surface-600 dark:text-surface-400">
			<p class="font-semibold">Nenhuma solicitação pendente.</p>
			<p class="text-xs mt-1">Quando um servidor pedir alteração cadastral, ela aparecerá aqui.</p>
		</div>
	{:else}
		<div class="card-glass rounded-3xl overflow-hidden">
			<div class="table-wrap">
				<table class="table w-full text-sm">
					<thead>
						<tr
							class="text-left text-xs uppercase text-surface-600 dark:text-surface-400 border-b border-surface-200 dark:border-white/10"
						>
							<th class="py-3 px-4">Servidor</th>
							<th class="py-3 px-4">Campo</th>
							<th class="py-3 px-4">De</th>
							<th class="py-3 px-4">Para</th>
							<th class="py-3 px-4">Solicitada em</th>
							<th class="py-3 px-4 text-right">Ações</th>
						</tr>
					</thead>
					<tbody>
						{#each pendentes as s (s.id)}
							<tr
								class="border-b border-surface-100 dark:border-white/5 hover:bg-surface-100/50 dark:hover:bg-surface-800/30 transition-colors"
							>
								<td class="py-3 px-4">
									<p class="font-semibold leading-tight">{s.policial_nome}</p>
									<p class="text-xs text-surface-600 dark:text-surface-400">
										{s.policial_matricula} · {s.policial_cargo} · {s.policial_lotacao}
									</p>
								</td>
								<td class="py-3 px-4 font-medium">{ROTULO_CAMPO[s.campo]}</td>
								<td class="py-3 px-4 text-surface-600 dark:text-surface-400"
									>{s.valor_atual || '—'}</td
								>
								<td class="py-3 px-4 font-semibold">{s.valor_novo}</td>
								<td
									class="py-3 px-4 text-xs text-surface-600 dark:text-surface-400 whitespace-nowrap"
								>
									{new Date(s.created_at + (s.created_at.includes('T') ? '' : 'Z')).toLocaleString(
										'pt-BR',
										{ dateStyle: 'short', timeStyle: 'short' }
									)}
								</td>
								<td class="py-3 px-4">
									<div class="flex items-center gap-1.5 justify-end">
										<form
											method="POST"
											action="?/decidir"
											use:enhance={() => handleDecidir(s.id, 'aprovar')}
										>
											<input type="hidden" name="id" value={s.id} />
											<input type="hidden" name="decisao" value="aprovar" />
											<button
												type="submit"
												class="w-9 h-9 flex items-center justify-center rounded-xl bg-success-500/10 text-success-600 dark:text-success-400 hover:bg-success-500 hover:text-white active:scale-95 transition-all disabled:opacity-40"
												title="Aprovar e aplicar"
												aria-label="Aprovar solicitação de {s.policial_nome}"
												disabled={decidindoId === s.id}
											>
												<svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
													<path
														stroke-linecap="round"
														stroke-linejoin="round"
														stroke-width="2.5"
														d="M5 13l4 4L19 7"
													/>
												</svg>
											</button>
										</form>
										<form
											method="POST"
											action="?/decidir"
											use:enhance={() => handleDecidir(s.id, 'rejeitar')}
										>
											<input type="hidden" name="id" value={s.id} />
											<input type="hidden" name="decisao" value="rejeitar" />
											<button
												type="submit"
												class="w-9 h-9 flex items-center justify-center rounded-xl bg-error-500/10 text-error-600 dark:text-error-400 hover:bg-error-500 hover:text-white active:scale-95 transition-all disabled:opacity-40"
												title="Rejeitar"
												aria-label="Rejeitar solicitação de {s.policial_nome}"
												disabled={decidindoId === s.id}
											>
												<svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
													<path
														stroke-linecap="round"
														stroke-linejoin="round"
														stroke-width="2.5"
														d="M6 18L18 6M6 6l12 12"
													/>
												</svg>
											</button>
										</form>
									</div>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</div>
	{/if}
</div>
