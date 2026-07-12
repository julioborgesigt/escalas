<script lang="ts">
	import { Dialog } from '@skeletonlabs/skeleton-svelte';
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { toaster } from '$lib/toast';
	import CalendarioSelecaoDias from './CalendarioSelecaoDias.svelte';
	import type { EscalaPolicialComDados } from '$lib/types';
	import type { ActionResult } from '@sveltejs/kit';

	let {
		open = $bindable(false),
		diasIniciais,
		onsalvo
	}: {
		open: boolean;
		diasIniciais: string[];
		onsalvo: (result: {
			data_inicio: string;
			data_fim: string;
			policiais: EscalaPolicialComDados[];
		}) => void;
	} = $props();

	let selecionados = $state<string[]>([]);
	let calAno = $state(new Date().getFullYear());
	let calMes = $state(new Date().getMonth());
	let pending = $state(false);

	$effect(() => {
		if (open) {
			selecionados = [...diasIniciais];
			if (diasIniciais.length > 0) {
				const [y, m] = diasIniciais[0].split('-').map(Number);
				calAno = y;
				calMes = m - 1;
			}
		}
	});

	const ordenados = $derived([...selecionados].sort());
	const diasJson = $derived(JSON.stringify(ordenados));

	function handleSalvar({ cancel }: { cancel: () => void }) {
		if (ordenados.length === 0) {
			toaster.create({ title: 'Selecione pelo menos um dia', type: 'error' });
			cancel();
			return;
		}
		pending = true;
		return async ({ result }: { result: ActionResult }) => {
			pending = false;
			if (result.type === 'success') {
				onsalvo({
					data_inicio: result.data?.data_inicio,
					data_fim: result.data?.data_fim,
					policiais: result.data?.policiais
				});
				open = false;
				toaster.create({ title: 'Dias da escala atualizados!', type: 'success' });
				await invalidateAll();
			} else if (result.type === 'error') {
				toaster.create({ title: 'Erro de conexão. Tente novamente.', type: 'error' });
			} else {
				const d =
					result.type === 'failure'
						? (result.data as Record<string, unknown> | undefined)
						: undefined;
				toaster.create({ title: String(d?.error || 'Erro ao atualizar dias'), type: 'error' });
			}
		};
	}
</script>

<Dialog {open} onOpenChange={(e) => (open = e.open)}>
	<Dialog.Content
		class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-surface-950/80 backdrop-blur-sm overflow-y-auto"
	>
		<div
			class="card w-full max-w-sm max-h-[calc(100dvh-2rem)] overflow-y-auto card-elevated shadow-2xl rounded-2xl border border-warning-500/20 p-4 sm:p-5 space-y-4"
		>
			<div>
				<Dialog.Title class="font-bold text-base">Editar Qtd. dias da escala</Dialog.Title>
				<Dialog.Description class="text-xs text-surface-500 mt-0.5">
					Selecione os dias. Dias com policiais escalados não podem ser removidos.
				</Dialog.Description>
			</div>

			<CalendarioSelecaoDias
				bind:selecionados
				bind:ano={calAno}
				bind:mes={calMes}
				modo="intervalo"
				cor="warning"
				mostrarChips
			/>

			<!-- Ações -->
			<div class="flex justify-end gap-2 pt-1">
				<button
					type="button"
					class="btn text-xs px-3 py-1.5 rounded-lg border border-surface-300 dark:border-surface-600 text-surface-600 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
					onclick={() => (open = false)}
				>
					Cancelar
				</button>
				<form method="POST" action="?/editarDiasEscala" use:enhance={handleSalvar} class="contents">
					<input type="hidden" name="datas" value={diasJson} />
					<button
						type="submit"
						class="btn text-xs font-bold px-4 py-1.5 rounded-lg preset-filled-warning-500"
						disabled={pending || ordenados.length === 0}
					>
						{pending ? 'Salvando...' : 'Salvar dias'}
					</button>
				</form>
			</div>
		</div>
	</Dialog.Content>
</Dialog>
