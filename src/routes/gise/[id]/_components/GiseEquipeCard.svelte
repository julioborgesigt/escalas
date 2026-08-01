<script lang="ts">
	/**
	 * Card de uma equipe dentro de um slot de unidade: vagas DPC/OIP, horários
	 * (com edição inline do Admin Geral), membros e o fluxo de adicionar membro.
	 * O estado de edição vem de `GiseSeccionalEstado` (compartilhado com os
	 * demais cards — os fluxos são mutuamente exclusivos por id).
	 */
	import { enhance } from '$app/forms';
	import type { GiseDetalhado, GiseEquipeComMembros } from '$lib/db/gise';
	import SearchableSelect from '$lib/components/SearchableSelect.svelte';
	import MarcadorPresenca from './MarcadorPresenca.svelte';
	import { validarHora, normalizarHora } from '$lib/gise/horarios';
	import type { GiseSeccionalActions } from '$lib/composables/gise/useGiseSeccionalActions.svelte';
	import type { GiseSeccionalEstado } from './gise-seccional-estado.svelte';

	type Seccional = GiseDetalhado['seccionais'][number];

	const {
		equipe,
		sec,
		gise,
		isAdminGeral,
		isSeccional,
		podeEditar,
		modoEdicaoGeral,
		minhaSeccionalId,
		estado,
		actions
	}: {
		equipe: GiseEquipeComMembros;
		sec: Seccional;
		gise: GiseDetalhado;
		isAdminGeral: boolean;
		isSeccional: boolean;
		podeEditar: boolean;
		modoEdicaoGeral: boolean;
		minhaSeccionalId: number | null;
		estado: GiseSeccionalEstado;
		actions: GiseSeccionalActions;
	} = $props();

	// Mesma regra usada duas vezes no template original (remover/adicionar
	// membro): Admin Geral em modo edição, ou Adm Seccional da própria
	// seccional com a escala editável.
	const podeEditarMembros = $derived(
		podeEditar &&
			((isAdminGeral && modoEdicaoGeral) ||
				(isSeccional &&
					sec.seccional_id === minhaSeccionalId &&
					(estado.modoEdicaoSeccional || sec.status === 'pendente' || sec.status === 'retificada')))
	);

	const buscarMembroAdicional = $derived(
		estado.cargoParaAdicionar ? actions.buscarPorCargo(estado.cargoParaAdicionar) : undefined
	);
</script>

<div
	class="flex-1 rounded-xl border border-surface-200 dark:border-surface-700/60 p-3 sm:p-4 bg-white dark:bg-surface-900 shadow-sm hover:shadow-md transition-shadow duration-200"
>
	<div class="mb-3 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between lg:gap-4">
		{#if isAdminGeral && podeEditar && modoEdicaoGeral}
			<form
				id="remover-equipe-form-{equipe.id}"
				method="POST"
				action="?/removerEquipe"
				use:enhance={actions.handleRemoverEquipe}
				class="hidden"
				aria-hidden="true"
			>
				<input type="hidden" name="equipeId" value={equipe.id} />
			</form>
		{/if}

		<div class="flex min-w-0 items-center justify-between gap-2 lg:contents">
			<span
				class="min-w-0 shrink text-sm font-semibold capitalize text-surface-900 dark:text-surface-100 lg:shrink-0"
			>
				Equipe {equipe.tipo === 'operacional' ? 'Operacional' : 'SEINT'}
			</span>
			{#if isAdminGeral && podeEditar && modoEdicaoGeral}
				<button
					type="submit"
					form="remover-equipe-form-{equipe.id}"
					class="btn btn-sm preset-outlined-error-500 inline-flex shrink-0 items-center justify-center gap-1 whitespace-nowrap px-2 py-1 text-xs lg:hidden"
					disabled={actions.pendingCrud}
				>
					{actions.pendingRemoverEquipe ? 'Removendo...' : 'Remover equipe'}
				</button>
			{/if}
		</div>

		<div
			class="flex min-w-0 flex-1 gap-2 lg:flex-row lg:flex-wrap lg:items-center lg:justify-end lg:gap-x-3 lg:gap-y-2 {estado.editandoEquipe ===
				equipe.id || estado.editandoHorariosEquipeId === equipe.id
				? 'flex-col'
				: 'flex-row flex-wrap items-center'}"
		>
			{#if estado.editandoEquipe === equipe.id}
				<div class="flex flex-wrap items-center gap-1.5">
					<label for="edit-dpc-{equipe.id}" class="text-sm text-surface-500">DPC:</label>
					<input
						id="edit-dpc-{equipe.id}"
						type="number"
						min="0"
						max="20"
						bind:value={estado.editSlotsDpc}
						class="w-14 px-2 py-1 rounded-xl border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-800 text-sm text-center"
					/>
					<label for="edit-oip-{equipe.id}" class="text-sm text-surface-500">OIP:</label>
					<input
						id="edit-oip-{equipe.id}"
						type="number"
						min="0"
						max="20"
						bind:value={estado.editSlotsOip}
						class="w-14 px-2 py-1 rounded-xl border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-800 text-sm text-center"
					/>
					<div class="flex items-center gap-2 shrink-0">
						<form
							method="POST"
							action="?/salvarSlotsEquipe"
							use:enhance={actions.handleSalvarSlotsEquipe}
							class="contents"
						>
							<input type="hidden" name="equipeId" value={equipe.id} />
							<input type="hidden" name="slots_dpc" value={estado.editSlotsDpc} />
							<input type="hidden" name="slots_oip" value={estado.editSlotsOip} />
							<button
								type="submit"
								class="btn btn-sm preset-filled-primary-500 text-sm py-1 px-2 rounded transition-all"
								disabled={actions.pendingCrud}
								aria-label="Salvar vagas"
								title="Confirmar">{actions.pendingSalvarSlotsEquipe ? '…' : '✓'}</button
							>
						</form>
						<button
							type="button"
							class="btn btn-sm preset-outlined-primary-500 text-sm py-1 px-2 rounded"
							onclick={() => (estado.editandoEquipe = null)}
							aria-label="Cancelar edição de vagas"
							title="Cancelar">×</button
						>
					</div>
				</div>
			{:else}
				<div class="flex flex-wrap items-center gap-2 min-w-0">
					<span class="text-sm text-surface-500"
						>{equipe.slots_dpc} DPC + {equipe.slots_oip} OIP</span
					>
					{#if isAdminGeral && podeEditar && modoEdicaoGeral}
						<button
							type="button"
							class="btn btn-xs preset-filled-surface-500 rounded p-1 shrink-0"
							onclick={() => {
								estado.editandoEquipe = equipe.id;
								estado.editSlotsDpc = equipe.slots_dpc;
								estado.editSlotsOip = equipe.slots_oip;
							}}
							title="Editar vagas da equipe"
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
			{/if}

			{#if estado.editandoHorariosEquipeId === equipe.id}
				<div class="flex flex-wrap items-center gap-2">
					<input
						type="text"
						placeholder="08:00"
						class="w-16 px-2 py-1 text-sm rounded border bg-white dark:bg-surface-900 {estado.editEqHoraEnt &&
						!validarHora(estado.editEqHoraEnt)
							? 'border-error-500'
							: 'border-surface-300 dark:border-surface-600'}"
						bind:value={estado.editEqHoraEnt}
					/>
					<span class="opacity-30">-</span>
					<input
						type="text"
						placeholder="16:00"
						class="w-16 px-2 py-1 text-sm rounded border bg-white dark:bg-surface-900 {estado.editEqHoraSai &&
						!validarHora(estado.editEqHoraSai)
							? 'border-error-500'
							: 'border-surface-300 dark:border-surface-600'}"
						bind:value={estado.editEqHoraSai}
					/>
					<div class="flex items-center gap-2 shrink-0">
						<form
							method="POST"
							action="?/salvarHorariosEquipe"
							use:enhance={actions.handleSalvarHorariosEquipe}
							class="contents"
						>
							<input type="hidden" name="eqId" value={equipe.id} />
							<input
								type="hidden"
								name="hora_entrada"
								value={normalizarHora(estado.editEqHoraEnt) ?? ''}
							/>
							<input
								type="hidden"
								name="hora_saida"
								value={normalizarHora(estado.editEqHoraSai) ?? ''}
							/>
							<button
								type="submit"
								class="btn btn-sm preset-filled-primary-500 text-sm py-1 px-2 rounded transition-all"
								disabled={actions.pendingCrud}
								title="Confirmar">{actions.pendingSalvarHorariosEquipe ? '…' : '✓'}</button
							>
						</form>
						<button
							type="button"
							class="btn btn-sm preset-outlined-primary-500 text-sm py-1 px-2 rounded"
							onclick={() => (estado.editandoHorariosEquipeId = null)}>×</button
						>
					</div>
				</div>
			{:else}
				<div class="flex flex-wrap items-center gap-2 min-w-0">
					<div
						class="flex flex-wrap items-center gap-1.5 text-sm text-surface-500 dark:text-surface-400 font-medium min-w-0"
					>
						<span
							>{equipe.hora_entrada ?? sec.hora_entrada ?? gise.hora_entrada}h-{equipe.hora_saida ??
								sec.hora_saida ??
								gise.hora_saida}h</span
						>
						{#if equipe.hora_entrada || equipe.hora_saida}
							<span
								class="px-1 rounded bg-warning-500/10 text-warning-600 dark:text-warning-400 font-bold border border-warning-500/20 uppercase"
								>H. Personalizado</span
							>
						{/if}
					</div>
					{#if isAdminGeral && podeEditar && modoEdicaoGeral}
						<button
							type="button"
							class="btn btn-xs preset-filled-surface-500 rounded p-1 shrink-0"
							onclick={() => {
								estado.editandoHorariosEquipeId = equipe.id;
								estado.editEqHoraEnt =
									equipe.hora_entrada ?? sec.hora_entrada ?? gise.hora_entrada ?? '';
								estado.editEqHoraSai = equipe.hora_saida ?? sec.hora_saida ?? gise.hora_saida ?? '';
							}}
							title="Editar horários da equipe"
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
			{/if}

			{#if isAdminGeral && podeEditar && modoEdicaoGeral}
				<button
					type="submit"
					form="remover-equipe-form-{equipe.id}"
					class="btn btn-sm preset-outlined-error-500 hidden w-full items-center justify-center gap-1 whitespace-nowrap lg:inline-flex lg:w-auto"
					disabled={actions.pendingCrud}
				>
					{actions.pendingRemoverEquipe ? 'Removendo...' : 'Remover equipe'}
				</button>
			{/if}
		</div>
	</div>

	<!-- Membros -->
	{#if equipe.membros?.length}
		<div class="space-y-1 mb-2">
			{#each equipe.membros as m (m.id)}
				<div
					class="flex items-center justify-between text-sm px-3 py-1.5 rounded-lg bg-surface-100 dark:bg-surface-800"
				>
					<div class="flex items-center gap-2">
						<span class="font-semibold text-surface-900 dark:text-surface-100"
							>{m.policial_nome}</span
						>
						<span class="text-surface-500">{m.policial_cargo} · {m.policial_matricula}</span>
						<!-- Estado de presença SEMPRE explícito (entrada e saída). Antes só
						     havia selo quando a entrada existia, então "aguardando entrada"
						     ficava visualmente idêntico a "sem informação". -->
						<MarcadorPresenca
							entrada={!!m.presenca?.entrada_timestamp}
							saida={!!m.presenca?.saida_timestamp}
						/>
					</div>
					{#if podeEditarMembros}
						<form
							method="POST"
							action="?/removerMembro"
							use:enhance={actions.handleRemoverMembro}
							class="ml-2"
						>
							<input type="hidden" name="memId" value={m.id} />
							<button
								type="submit"
								class="inline-flex items-center justify-center w-5 h-9 rounded-md border border-error-500/35 bg-error-500/10 text-error-600 hover:bg-error-500/20 hover:text-error-700 dark:text-error-400 dark:hover:text-error-300 transition-colors touch-manipulation -mr-1"
								aria-label="Remover policial da equipe"
								title="Remover policial"
								disabled={actions.pendingCrud}
							>
								{#if actions.pendingRemoverMembro}…{:else}×{/if}
							</button>
						</form>
					{/if}
				</div>
			{/each}
		</div>
	{:else}
		<p class="text-sm text-surface-500 dark:text-surface-400 italic mb-3">Nenhum membro alocado</p>
	{/if}

	<!-- Adicionar membro -->
	{#if podeEditarMembros}
		{#if estado.equipeParaAdicionar === equipe.id}
			<form method="POST" action="?/adicionarMembro" use:enhance={actions.handleAdicionarMembro}>
				<input type="hidden" name="secId" value={sec.id} />
				<input type="hidden" name="equipe_id" value={estado.equipeParaAdicionar} />
				<input type="hidden" name="policial_id" value={estado.policialParaAdicionar} />
				<div class="flex flex-col sm:flex-row gap-2 sm:items-end">
					<div class="w-full flex-1 min-w-32">
						{#key estado.cargoParaAdicionar}
							<SearchableSelect
								bind:value={estado.policialParaAdicionar}
								loadOptions={buscarMembroAdicional}
								placeholder={`Pesquisar ${estado.cargoParaAdicionar}...`}
								class="w-full"
							/>
						{/key}
					</div>
					<div class="w-full sm:w-auto flex gap-2">
						<button
							type="submit"
							class="btn preset-filled-primary-500 text-sm px-3 py-1.5 rounded-lg flex-1 sm:flex-none transition-all"
							disabled={!estado.policialParaAdicionar || actions.pendingCrud}
							>{actions.pendingAdicionarMembro ? 'Adicionando...' : 'Adicionar'}</button
						>
						<button
							type="button"
							class="btn preset-outlined-primary-500 text-sm px-3 py-1.5 rounded-lg flex-1 sm:flex-none"
							onclick={() => {
								estado.equipeParaAdicionar = null;
								estado.policialParaAdicionar = '';
								estado.cargoParaAdicionar = null;
							}}>Fechar</button
						>
					</div>
				</div>
			</form>
		{:else if !isAdminGeral}
			<div class="flex flex-wrap gap-2">
				<button
					type="button"
					class="btn btn-sm preset-outlined-success-500 w-full sm:w-auto flex items-center justify-center gap-1 whitespace-nowrap"
					onclick={() => {
						estado.equipeParaAdicionar = equipe.id;
						estado.cargoParaAdicionar = 'OIP';
						estado.policialParaAdicionar = '';
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
					+ Adicionar OIP
				</button>
				{#if equipe.slots_dpc > 0}
					<button
						type="button"
						class="btn btn-sm preset-outlined-success-500 w-full sm:w-auto flex items-center justify-center gap-1 whitespace-nowrap"
						onclick={() => {
							estado.equipeParaAdicionar = equipe.id;
							estado.cargoParaAdicionar = 'DPC';
							estado.policialParaAdicionar = '';
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
						+ Adicionar DPC
					</button>
				{/if}
			</div>
		{/if}
	{/if}
</div>
