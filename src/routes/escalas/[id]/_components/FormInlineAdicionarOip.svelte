<script lang="ts">
	import { enhance } from '$app/forms';
	import { toaster } from '$lib/toast';
	import { proximoDia } from '$lib/utils';
	import SearchableSelect from '$lib/components/SearchableSelect.svelte';
	import { SvelteDate, SvelteURLSearchParams } from 'svelte/reactivity';
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
	let addPrimeiroPlantao = $state('');
	let addPrimeiroDia = $state('');

	$effect(() => {
		if (addPrimeiroDia && escala.data_inicio) {
			const [ano, mes] = escala.data_inicio.split('-');
			addPrimeiroPlantao = `${ano}-${mes}-${addPrimeiroDia.toString().padStart(2, '0')}`;
		} else {
			addPrimeiroPlantao = '';
		}
	});

	function ultimoDiaMes(dataStr: string) {
		if (!dataStr) return 31;
		const [ano, mes] = dataStr.split('-');
		return new Date(Number(ano), Number(mes), 0).getDate();
	}

	function mesAnoFormatado(dataStr: string) {
		if (!dataStr) return '';
		const [ano, mes] = dataStr.split('-');
		return `${mes}/${ano}`;
	}

	function calcularDataSaidaInicial(de: string, he: string, hs: string): string {
		const hEnt = Number(he.split(':')[0]);
		const hSai = Number(hs.split(':')[0]);
		if (hSai <= hEnt) return proximoDia(de);
		return de;
	}

	function calcularDatasPlantao(primeiroPlantao: string, tipo: '1x3' | '2x6'): string[] {
		if (!primeiroPlantao) return [];
		const datas: string[] = [];
		const inicio = new Date(escala.data_inicio + 'T00:00:00');
		const fim = new Date(escala.data_fim + 'T00:00:00');
		const d = new SvelteDate(primeiroPlantao + 'T00:00:00');
		if (tipo === '1x3') {
			while (d <= fim) {
				if (d >= inicio) datas.push(d.toISOString().split('T')[0]);
				d.setDate(d.getDate() + 4);
			}
		} else {
			while (d <= fim) {
				if (d >= inicio) datas.push(d.toISOString().split('T')[0]);
				const d2 = new SvelteDate(d);
				d2.setDate(d2.getDate() + 1);
				if (d2 <= fim && d2 >= inicio) datas.push(d2.toISOString().split('T')[0]);
				d.setDate(d.getDate() + 8);
			}
		}
		return datas;
	}

	const datasCalc = $derived(calcularDatasPlantao(addPrimeiroPlantao, addTipoEscala));

	const datasPlantaoJson = $derived(
		JSON.stringify(
			datasCalc.map((d) => ({
				data_plantao: d,
				data_saida: calcularDataSaidaInicial(d, '08:00', '08:00')
			}))
		)
	);

	let pendingPlantao = $state(false);

	async function buscarPoliciaisAsync(q: string, sig: AbortSignal) {
		const params = new SvelteURLSearchParams({ cargo: 'OIP', limit: '50' });
		if (q) params.set('q', q);
		const res = await fetch(`/api/policiais/search?${params}`, { signal: sig });
		if (!res.ok) {
			const err = await res.json().catch(() => ({ error: 'Erro na busca' }));
			throw new Error(err.error ?? 'Erro na busca');
		}
		const json = (await res.json()) as {
			policiais: { id: number; nome: string; lotacao: string }[];
		};
		return json.policiais.map((p) => ({
			value: String(p.id),
			label: `${p.nome}${p.lotacao ? ' — ' + p.lotacao : ''}`
		}));
	}

	function handlePlantao({ cancel }: { cancel: () => void }) {
		if (!policialId || datasCalc.length === 0) {
			cancel();
			return;
		}
		pendingPlantao = true;
		return async ({ result }: { result: ActionResult }) => {
			pendingPlantao = false;
			if (result.type === 'success') {
				onSuccess(result.data?.policiais);
				const conflitantes =
					(result.data?.conflitantes as { data: string; motivo: string }[] | undefined) ?? [];
				if (conflitantes.length > 0) {
					const datas = conflitantes.map((c) => c.data).join(', ');
					toaster.create({
						title: `Adicionado — ${conflitantes.length} dia(s) com choque ignorado(s)`,
						description: `Dias ignorados: ${datas}`,
						type: 'warning'
					});
				} else {
					toaster.create({ title: 'Servidor adicionado à escala de plantão', type: 'success' });
				}
				onCancel();
			} else if (result.type === 'error') {
				toaster.create({ title: 'Erro de conexão. Tente novamente.', type: 'error' });
			} else {
				const d =
					result.type === 'failure'
						? (result.data as Record<string, unknown> | undefined)
						: undefined;
				toaster.create({ title: String(d?.error || 'Erro ao adicionar'), type: 'error' });
			}
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
