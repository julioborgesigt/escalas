<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateShared } from '$lib/cross-tab-invalidate';
	import ModalShell from '$lib/components/ModalShell.svelte';
	import { toaster } from '$lib/toast';
	import CalendarioSelecaoDias from './CalendarioSelecaoDias.svelte';
	import type { EscalaPolicialComDados } from '$lib/types';
	import type { ActionResult } from '@sveltejs/kit';

	let {
		open = $bindable(false),
		escalaId,
		diasIniciais,
		onsalvo
	}: {
		open: boolean;
		escalaId: number;
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
				await invalidateShared(`escala:${escalaId}`, 'app:escalas');
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

<ModalShell
	bind:open
	title="Editar Qtd. dias da escala"
	description="Selecione os dias. Dias com policiais escalados não podem ser removidos."
	{pending}
	cancelLabel="Cancelar"
>
	<div class="rounded-xl border border-warning-500/20 p-4 sm:p-5">
		<CalendarioSelecaoDias
			bind:selecionados
			bind:ano={calAno}
			bind:mes={calMes}
			modo="intervalo"
			cor="warning"
			mostrarChips
		/>
	</div>

	{#snippet footer()}
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
	{/snippet}
</ModalShell>
