<script lang="ts">
	import { Dialog, SegmentedControl, Switch } from '@skeletonlabs/skeleton-svelte';
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { toaster } from '$lib/toast';
	import { CIDADES_CEARA } from '$lib/constants/cidades';
	import type { Unidade } from '$lib/types';
	import SearchableSelect from '$lib/components/SearchableSelect.svelte';

	let {
		open = $bindable(false),
		seccionais
	}: {
		open: boolean;
		seccionais: Unidade[];
	} = $props();

	let tipoUnidade = $state<'delegacia' | 'seccional'>('delegacia');
	let delegaciaPrefixo = $state('');
	let delegaciaSufixo = $state('');
	let seccionalPrefixo = $state('');
	let seccionalSufixo = $state('Interior Sul');
	let novoSeccionalId = $state<number | null>(null);
	let novoTemPlantao = $state(false);
	let novoTemExpediente = $state(false);
	let novoTemFds = $state(false);
	let buscaCidade = $state<string | null>('');
	let pending = $state(false);

	const cidadesOptions = CIDADES_CEARA.map((c) => ({ value: c, label: c }));

	const novoNome = $derived(
		tipoUnidade === 'delegacia'
			? `${delegaciaPrefixo ? delegaciaPrefixo + ' ' : ''}Delegacia de Polícia Civil de ${delegaciaSufixo}`.trim()
			: `${seccionalPrefixo ? seccionalPrefixo + ' ' : ''}Seccional do ${seccionalSufixo}`.trim()
	);

	function reset() {
		delegaciaPrefixo = '';
		delegaciaSufixo = '';
		seccionalPrefixo = '';
		seccionalSufixo = 'Interior Sul';
		novoSeccionalId = null;
		novoTemPlantao = false;
		novoTemExpediente = false;
		novoTemFds = false;
		buscaCidade = '';
	}

	function handleCadastro() {
		pending = true;
		return async ({ result }: { result: any }) => {
			pending = false;
			if (result.type === 'success') {
				await invalidateAll();
				toaster.create({ title: 'Unidade cadastrada com sucesso!', type: 'success' });
				reset();
				open = false;
			} else if (result.type === 'failure') {
				const d = result.data as Record<string, unknown> | undefined;
				toaster.create({ title: String(d?.error || 'Erro ao cadastrar'), type: 'error' });
			}
		};
	}
</script>

<Dialog
	{open}
	onOpenChange={(e) => {
		open = e.open;
		if (!e.open) reset();
	}}
>
	<Dialog.Content
		class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-surface-950/80 backdrop-blur-sm overflow-y-auto"
	>
		<div
			class="card p-4 sm:p-6 max-w-md w-full max-h-[calc(100dvh-2rem)] overflow-y-auto bg-surface-100 dark:bg-surface-900 shadow-2xl rounded-2xl border border-surface-200 dark:border-white/10"
		>
			<Dialog.Title class="h3 font-bold mb-5">Cadastrar Nova Unidade</Dialog.Title>
			<form method="POST" action="?/criar" use:enhance={handleCadastro} class="flex flex-col gap-4">
				<input type="hidden" name="nome" value={novoNome} />
				<input type="hidden" name="tipo" value={tipoUnidade} />
				<input type="hidden" name="seccional_id" value={novoSeccionalId ?? ''} />
				<input type="hidden" name="tem_plantao" value={novoTemPlantao ? 'on' : ''} />
				<input type="hidden" name="tem_expediente" value={novoTemExpediente ? 'on' : ''} />
				<input type="hidden" name="tem_fds" value={novoTemFds ? 'on' : ''} />

				<div
					class="flex flex-col gap-2 p-4 bg-surface-200/30 dark:bg-surface-800/20 rounded-xl border border-surface-200 dark:border-white/5"
				>
					<SegmentedControl
						value={tipoUnidade}
						onValueChange={(e) => (tipoUnidade = e.value as 'delegacia' | 'seccional')}
						class="w-full"
					>
						<SegmentedControl.Label class="text-sm font-semibold text-surface-600 dark:text-surface-400">
							Tipo de Unidade
						</SegmentedControl.Label>
						<SegmentedControl.Control class="w-full">
							<SegmentedControl.Indicator />
							<SegmentedControl.Item value="seccional" class="flex-1">
								<SegmentedControl.ItemText>Seccional</SegmentedControl.ItemText>
								<SegmentedControl.ItemHiddenInput />
							</SegmentedControl.Item>
							<SegmentedControl.Item value="delegacia" class="flex-1">
								<SegmentedControl.ItemText>Delegacia</SegmentedControl.ItemText>
								<SegmentedControl.ItemHiddenInput />
							</SegmentedControl.Item>
						</SegmentedControl.Control>
					</SegmentedControl>
				</div>

				<div class="flex flex-col gap-1">
					<span class="label-text font-semibold text-sm">Cidade no Ceará</span>
					<SearchableSelect
						name="cidade"
						options={cidadesOptions}
						bind:value={buscaCidade}
						placeholder="Buscar e selecionar cidade..."
					/>
				</div>

				{#if tipoUnidade === 'delegacia'}
					<div class="flex flex-col gap-3 animate-in fade-in duration-300">
						<label class="label">
							<span class="label-text">Seccional Vinculada</span>
							<select class="select" bind:value={novoSeccionalId}>
								<option value={null}>Selecione uma Seccional...</option>
								{#each seccionais as sec}
									<option value={sec.id}>{sec.nome}</option>
								{/each}
							</select>
						</label>
						<div class="grid grid-cols-[6rem_1fr] gap-2">
							<label class="label">
								<span class="label-text">Prefixo</span>
								<select class="select" bind:value={delegaciaPrefixo}>
									<option value="">—</option>
									{#each Array.from({ length: 99 }, (_, i) => `${i + 1}ª`) as ord}
										<option value={ord}>{ord}</option>
									{/each}
								</select>
							</label>
							<label class="label">
								<span class="label-text">Local (cidade / nome)</span>
								<input
									class="input"
									type="text"
									bind:value={delegaciaSufixo}
									placeholder="Iguatu"
								/>
							</label>
						</div>
					</div>
				{:else}
					<div class="flex flex-col gap-3 animate-in fade-in duration-300">
						<div class="grid grid-cols-[6rem_1fr] gap-2">
							<label class="label">
								<span class="label-text">Prefixo</span>
								<select class="select" bind:value={seccionalPrefixo}>
									<option value="">—</option>
									{#each Array.from({ length: 99 }, (_, i) => `${i + 1}ª`) as ord}
										<option value={ord}>{ord}</option>
									{/each}
								</select>
							</label>
							<label class="label">
								<span class="label-text">Local</span>
								<input
									class="input"
									type="text"
									bind:value={seccionalSufixo}
									placeholder="Interior Sul"
								/>
							</label>
						</div>
					</div>
				{/if}

				<div class="p-3 bg-primary-500/10 border border-primary-500/20 rounded-lg">
					<p class="text-[10px] uppercase font-bold text-primary-600 dark:text-primary-400 mb-1">
						Preview do Nome:
					</p>
					<p class="text-sm font-semibold truncate">{novoNome || 'Preencha os campos...'}</p>
				</div>

				<div
					class="flex flex-col gap-2 p-3 bg-surface-200/50 dark:bg-surface-800/50 rounded-xl border border-surface-300 dark:border-white/5"
				>
					<p class="text-sm font-medium text-surface-600 dark:text-surface-400">
						Regimes de Escala:
					</p>
					<div class="flex flex-col gap-2.5 sm:flex-row sm:gap-4 mt-1">
						<Switch
							checked={novoTemPlantao}
							onCheckedChange={(e) => (novoTemPlantao = e.checked)}
						>
							<Switch.Control>
								<Switch.Thumb />
							</Switch.Control>
							<Switch.Label>Plantão</Switch.Label>
							<Switch.HiddenInput />
						</Switch>
						<Switch
							checked={novoTemExpediente}
							onCheckedChange={(e) => (novoTemExpediente = e.checked)}
						>
							<Switch.Control>
								<Switch.Thumb />
							</Switch.Control>
							<Switch.Label>Exped.</Switch.Label>
							<Switch.HiddenInput />
						</Switch>
						<Switch
							checked={novoTemFds}
							onCheckedChange={(e) => (novoTemFds = e.checked)}
						>
							<Switch.Control>
								<Switch.Thumb />
							</Switch.Control>
							<Switch.Label>Fim de Semana</Switch.Label>
							<Switch.HiddenInput />
						</Switch>
					</div>
				</div>

				<div class="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 sm:gap-3 pt-1">
					<Dialog.CloseTrigger class="btn preset-outlined-surface-500">Cancelar</Dialog.CloseTrigger>
					<button
						type="submit"
						class="btn preset-filled-primary-500 flex items-center gap-2 active:scale-95 transition-all"
						disabled={pending ||
							!novoNome.trim() ||
							!buscaCidade?.trim() ||
							(tipoUnidade === 'delegacia' && !novoSeccionalId)}
					>
						{pending ? 'Cadastrando...' : 'Cadastrar'}
					</button>
				</div>
			</form>
		</div>
	</Dialog.Content>
</Dialog>
