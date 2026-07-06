<script lang="ts">
	import { enhance } from '$app/forms';
	import { buscarPoliciaisOptions } from '$lib/busca-policiais';
	import SearchableSelect from '$lib/components/SearchableSelect.svelte';
	import {
		ultimoDiaMes,
		mesAnoFormatado,
		primeiroPlantaoDoDia,
		calcularDatasPlantao,
		datasPlantaoParaJson,
		tratarResultadoAdicionarPlantao
	} from './plantao-datas';
	import type { ActionResult } from '@sveltejs/kit';
	import type { Escala } from '$lib/server/schema';
	import type { EscalaPolicialComDados } from '$lib/types';

	interface Props {
		escala: Escala;
		equipe: string;
		onCancel: () => void;
		onSuccess: (policiais: EscalaPolicialComDados[]) => void;
	}

	const { escala, equipe, onCancel, onSuccess }: Props = $props();

	let policialId = $state('');
	let addTipoEscala = $state<'1x3' | '2x6'>('1x3');
	let addPrimeiroDia = $state('');
	const addPrimeiroPlantao = $derived(
		primeiroPlantaoDoDia(escala.data_inicio ?? '', addPrimeiroDia)
	);

	const datasCalc = $derived(calcularDatasPlantao(escala, addPrimeiroPlantao, addTipoEscala));

	const datasPlantaoJson = $derived(datasPlantaoParaJson(datasCalc, '08:00', '08:00'));

	let pendingPlantao = $state(false);

	const buscarPoliciaisAsync = buscarPoliciaisOptions({ cargo: 'OIP' });

	function handlePlantao({ cancel }: { cancel: () => void }) {
		if (!policialId || datasCalc.length === 0) {
			cancel();
			return;
		}
		pendingPlantao = true;
		return async ({ result }: { result: ActionResult }) => {
			pendingPlantao = false;
			tratarResultadoAdicionarPlantao(result, onSuccess, onCancel);
		};
	}
</script>

<form
	method="POST"
	action="?/adicionarPlantao"
	use:enhance={handlePlantao}
	class="p-4 bg-surface-50/80 dark:bg-surface-800/60 border-t border-surface-200 dark:border-white/10 rounded-b-2xl"
>
	<input type="hidden" name="equipe" value={equipe} />
	<input type="hidden" name="datas" value={datasPlantaoJson} />

	<div class="grid grid-cols-1 sm:grid-cols-12 gap-4 items-end">
		<label class="label sm:col-span-5">
			<span class="label-text">Policial (OIP)</span>
			<SearchableSelect
				name="policial_id"
				bind:value={policialId}
				loadOptions={buscarPoliciaisAsync}
				placeholder="Buscar servidor..."
				class="w-full h-9"
			/>
		</label>
		<label class="label sm:col-span-2">
			<span class="label-text">Tipo de Escala</span>
			<select class="select h-9 py-0 px-2" bind:value={addTipoEscala}>
				<option value="1x3">1×3</option>
				<option value="2x6">2×6</option>
			</select>
		</label>
		<div class="sm:col-span-2">
			<span class="label-text block text-sm mb-1">1º dia</span>
			<div class="flex items-center gap-1 h-9">
				<input
					type="number"
					class="input h-9 w-12 text-center p-1"
					bind:value={addPrimeiroDia}
					min="1"
					max={ultimoDiaMes(escala.data_inicio)}
					required
				/>
				<span class="text-sm font-medium opacity-70">/ {mesAnoFormatado(escala.data_inicio)}</span>
			</div>
		</div>
		<div class="sm:col-span-3 flex gap-2 h-9 items-center">
			<button
				type="submit"
				class="btn btn-sm preset-filled-primary-500 active:scale-95 transition-all flex-1"
				disabled={pendingPlantao || !policialId || !addPrimeiroPlantao}
			>
				{pendingPlantao ? 'Salvando...' : 'Adicionar OIP'}
			</button>
			<button type="button" class="btn btn-sm preset-outlined-surface-500" onclick={onCancel}>
				Cancelar
			</button>
		</div>
	</div>
</form>
