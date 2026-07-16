<script lang="ts">
	import { enhance } from '$app/forms';
	import type { GiseDetalhado, GiseUnidadeSlot } from '$lib/db/gise';
	import type { Unidade } from '$lib/server/schema';
	import type { GiseSeccionalActions } from '$lib/composables/gise/useGiseSeccionalActions.svelte';
	import type { GiseSeccionalEstado } from './gise-seccional-estado.svelte';
	import GiseEquipeCard from './GiseEquipeCard.svelte';

	type Seccional = GiseDetalhado['seccionais'][number];

	/**
	 * Slot de unidade (DP) dentro de uma seccional: cabeçalho com seleção/troca
	 * da unidade, grid de equipes (GiseEquipeCard) e o fluxo do Admin Geral de
	 * adicionar equipe. Estado de edição compartilhado via GiseSeccionalEstado.
	 */
	const {
		slot,
		sec,
		gise,
		todasUnidades,
		isAdminGeral,
		isSeccional,
		podeEditar,
		modoEdicaoGeral,
		minhaSeccionalId,
		estado,
		actions
	}: {
		slot: GiseUnidadeSlot;
		sec: Seccional;
		gise: GiseDetalhado;
		todasUnidades: Unidade[];
		isAdminGeral: boolean;
		isSeccional: boolean;
		podeEditar: boolean;
		modoEdicaoGeral: boolean;
		minhaSeccionalId: number | null;
		estado: GiseSeccionalEstado;
		actions: GiseSeccionalActions;
	} = $props();

	const podeEditarCabecalhoUnidade = $derived(
		(isSeccional &&
			sec.seccional_id === minhaSeccionalId &&
			(estado.modoEdicaoSeccional || sec.status === 'pendente' || sec.status === 'retificada')) ||
			(isAdminGeral && podeEditar && modoEdicaoGeral)
	);
</script>

<div
	class="rounded-xl border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-950 overflow-visible shadow-[inset_0_1px_3px_rgba(0,0,0,0.02)]"
>
	<!-- Cabeçalho do slot -->
	<div class="flex flex-col gap-2 px-4 py-3 border-b border-surface-200 dark:border-surface-800">
		{#if podeEditarCabecalhoUnidade && estado.selecionandoUnidadeSlotId === slot.id}
			<div class="flex flex-col sm:flex-row gap-2 w-full min-w-0 sm:items-center">
				<div class="w-full flex-1">
					<select
						bind:value={estado.slotUnidadeId}
						class="w-full px-2 py-1.5 rounded-xl border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-800 text-sm font-medium"
					>
						<option value=""
							>{slot.nome ? 'Selecionar outra unidade...' : 'Selecionar unidade...'}</option
						>
						{#each todasUnidades.filter((d: Unidade) => d.tipo === 'delegacia' && d.seccional_id === sec.seccional_id && !(sec.unidades ?? []).some((s: GiseUnidadeSlot) => s.unidade_id === d.id && s.id !== slot.id)) as d (d.id)}
							<option value={d.id}>{d.nome}</option>
						{/each}
					</select>
				</div>
				<div class="w-full sm:w-auto flex gap-2 shrink-0">
					<form
						method="POST"
						action="?/selecionarUnidade"
						use:enhance={actions.handleSelecionarUnidade}
						class="flex-1 sm:flex-initial"
					>
						<input type="hidden" name="slotId" value={slot.id} />
						<input type="hidden" name="unidadeId" value={estado.slotUnidadeId} />
						<button
							type="submit"
							class="btn preset-filled-primary-500 text-sm px-4 py-1.5 rounded-xl w-full sm:w-auto sm:px-6 transition-all font-semibold"
							disabled={!estado.slotUnidadeId || actions.pendingCrud}
						>
							{actions.pendingSelecionarUnidade ? 'Salvando...' : 'Confirmar'}
						</button>
					</form>
					<button
						type="button"
						class="btn preset-outlined-primary-500 text-sm px-4 py-1.5 rounded-xl flex-1 sm:flex-initial sm:w-auto sm:px-6 font-semibold"
						onclick={() => {
							estado.selecionandoUnidadeSlotId = null;
							estado.slotUnidadeId = '';
						}}
					>
						Cancelar
					</button>
				</div>
				{#if isAdminGeral && podeEditar && modoEdicaoGeral}
					<form
						method="POST"
						action="?/removerUnidade"
						use:enhance={actions.handleRemoverUnidade}
						class="w-full sm:ml-auto sm:w-auto sm:flex sm:justify-end"
					>
						<input type="hidden" name="secId" value={sec.id} />
						<input type="hidden" name="linkId" value={slot.id} />
						<button
							type="submit"
							class="btn btn-sm preset-outlined-error-500 w-full sm:w-auto text-sm px-2 py-1 rounded-lg flex items-center justify-center gap-1 whitespace-nowrap"
							disabled={actions.pendingCrud}
						>
							<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"
								><path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M6 18L18 6M6 6l12 12"
								/></svg
							>
							{actions.pendingRemoverUnidade ? 'Removendo...' : 'Remover DP'}
						</button>
					</form>
				{/if}
			</div>
		{:else if slot.nome}
			<div class="flex w-full min-w-0 flex-row items-center justify-between gap-3">
				<div class="flex min-w-0 items-center gap-2">
					<span
						class="min-w-0 truncate font-semibold text-sm text-surface-900 dark:text-surface-100"
						>{slot.nome}</span
					>
					{#if podeEditarCabecalhoUnidade}
						<button
							type="button"
							class="btn btn-xs shrink-0 preset-filled-surface-500 rounded p-1"
							title="Alterar unidade"
							aria-label="Alterar unidade"
							onclick={() => {
								estado.selecionandoUnidadeSlotId = slot.id;
								estado.slotUnidadeId = slot.unidade_id ?? '';
							}}
						>
							<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"
								><path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
								/></svg
							>
						</button>
					{/if}
				</div>
				{#if isAdminGeral && podeEditar && modoEdicaoGeral}
					<form
						method="POST"
						action="?/removerUnidade"
						use:enhance={actions.handleRemoverUnidade}
						class="w-auto shrink-0 sm:self-start"
					>
						<input type="hidden" name="secId" value={sec.id} />
						<input type="hidden" name="linkId" value={slot.id} />
						<button
							type="submit"
							class="btn btn-sm preset-outlined-error-500 w-auto text-sm px-2 py-1 rounded-lg flex items-center justify-center gap-1 whitespace-nowrap"
							disabled={actions.pendingCrud}
						>
							<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"
								><path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M6 18L18 6M6 6l12 12"
								/></svg
							>
							{actions.pendingRemoverUnidade ? 'Removendo...' : 'Remover DP'}
						</button>
					</form>
				{/if}
			</div>
		{:else if podeEditarCabecalhoUnidade}
			<div class="flex flex-row items-center justify-between gap-2 w-full min-w-0">
				<button
					type="button"
					class="btn preset-outlined-warning-500 w-auto shrink-0 text-sm px-3 py-1.5 rounded-xl flex items-center justify-center gap-1.5"
					onclick={() => {
						estado.selecionandoUnidadeSlotId = slot.id;
						estado.slotUnidadeId = '';
					}}
				>
					<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"
						><path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-2 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
						/></svg
					>
					Definir DP
				</button>
				{#if isAdminGeral && podeEditar && modoEdicaoGeral}
					<form
						method="POST"
						action="?/removerUnidade"
						use:enhance={actions.handleRemoverUnidade}
						class="w-auto sm:min-w-0"
					>
						<input type="hidden" name="secId" value={sec.id} />
						<input type="hidden" name="linkId" value={slot.id} />
						<button
							type="submit"
							class="btn btn-sm preset-outlined-error-500 w-auto text-sm px-2 py-1 rounded-lg flex items-center justify-center gap-1 whitespace-nowrap"
							disabled={actions.pendingCrud}
						>
							<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"
								><path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M6 18L18 6M6 6l12 12"
								/></svg
							>
							{actions.pendingRemoverUnidade ? 'Removendo...' : 'Remover DP'}
						</button>
					</form>
				{/if}
			</div>
		{:else}
			<span class="text-sm text-surface-500 dark:text-surface-400 italic">Unidade não definida</span
			>
		{/if}
	</div>

	<!-- Equipes do slot -->
	<div
		class="px-3 pt-3 grid grid-cols-1 {slot.equipes?.length > 1
			? 'md:grid-cols-2'
			: ''} gap-3 {isAdminGeral && podeEditar && modoEdicaoGeral ? 'pb-1' : 'pb-3'}"
	>
		{#each slot.equipes ?? [] as equipe (equipe.id)}
			<GiseEquipeCard
				{equipe}
				{sec}
				{gise}
				{isAdminGeral}
				{isSeccional}
				{podeEditar}
				{modoEdicaoGeral}
				{minhaSeccionalId}
				{estado}
				{actions}
			/>
		{/each}
	</div>

	<!-- Admin Geral: adicionar equipe a este slot -->
	{#if isAdminGeral && podeEditar && modoEdicaoGeral}
		<div class="px-3 pb-3 flex justify-start">
			{#if estado.adicionandoEquipe && estado.adicionandoEquipeSlotId === slot.id}
				<div
					class="flex flex-wrap gap-2 items-end p-3 rounded-xl border border-dashed border-surface-300 dark:border-surface-600 w-full sm:w-auto"
				>
					<div>
						<label
							for="novaEquipeTipo-{slot.id}"
							class="text-sm font-medium text-surface-600 dark:text-surface-400 block mb-1"
							>Tipo</label
						>
						<select
							id="novaEquipeTipo-{slot.id}"
							bind:value={estado.novaEquipeTipo}
							onchange={() => {
								if (estado.novaEquipeTipo === 'operacional') {
									estado.novaEquipeDpc = 1;
									estado.novaEquipeOip = 3;
								} else {
									estado.novaEquipeDpc = 0;
									estado.novaEquipeOip = 2;
								}
							}}
							class="px-2 py-1.5 rounded-xl border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-800 text-sm"
						>
							<option value="operacional">Operacional</option>
							<option value="seint">SEINT</option>
						</select>
					</div>
					<div>
						<label
							for="novaEquipeDpc-{slot.id}"
							class="text-sm font-medium text-surface-600 dark:text-surface-400 block mb-1"
							>DPC</label
						>
						<input
							id="novaEquipeDpc-{slot.id}"
							type="number"
							min="0"
							max="20"
							bind:value={estado.novaEquipeDpc}
							class="w-14 px-2 py-1.5 rounded-xl border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-800 text-sm text-center"
						/>
					</div>
					<div>
						<label
							for="novaEquipeOip-{slot.id}"
							class="text-sm font-medium text-surface-600 dark:text-surface-400 block mb-1"
							>OIP</label
						>
						<input
							id="novaEquipeOip-{slot.id}"
							type="number"
							min="0"
							max="20"
							bind:value={estado.novaEquipeOip}
							class="w-14 px-2 py-1.5 rounded-xl border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-800 text-sm text-center"
						/>
					</div>
					<form
						method="POST"
						action="?/adicionarEquipe"
						use:enhance={actions.handleAdicionarEquipe}
						class="contents"
					>
						<input type="hidden" name="secId" value={sec.id} />
						<input type="hidden" name="unidadeId" value={slot.id} />
						<input type="hidden" name="tipo" value={estado.novaEquipeTipo} />
						<input type="hidden" name="slots_dpc" value={estado.novaEquipeDpc} />
						<input type="hidden" name="slots_oip" value={estado.novaEquipeOip} />
						<button
							type="submit"
							class="btn preset-filled-primary-500 text-sm px-3 py-1.5 rounded-lg transition-all"
							disabled={actions.pendingCrud}
							>{actions.pendingAdicionarEquipe ? 'Adicionando...' : 'Adicionar'}</button
						>
					</form>
					<button
						type="button"
						class="btn preset-outlined-surface-500 text-sm px-2 py-1.5 rounded-lg"
						onclick={() => {
							estado.adicionandoEquipe = false;
							estado.adicionandoEquipeSlotId = null;
						}}>Cancelar</button
					>
				</div>
			{:else}
				<button
					type="button"
					class="btn btn-sm preset-outlined-success-500 w-auto flex items-center justify-center gap-1 whitespace-nowrap mt-1"
					onclick={() => {
						estado.adicionandoEquipe = true;
						estado.adicionandoEquipeSlotId = slot.id;
						estado.novaEquipeTipo = 'operacional';
						estado.novaEquipeDpc = 1;
						estado.novaEquipeOip = 3;
					}}
				>
					<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"
						><path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"
						/></svg
					>
					+ Adicionar + equipe(s)
				</button>
			{/if}
		</div>
	{/if}
</div>
