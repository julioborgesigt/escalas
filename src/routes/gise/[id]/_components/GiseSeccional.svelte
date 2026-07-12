<script lang="ts">
	import { enhance } from '$app/forms';
	import { Accordion } from '@skeletonlabs/skeleton-svelte';
	import type { GiseDetalhado, GiseUnidadeSlot, GiseEquipeComMembros } from '$lib/db/gise';
	import type { Unidade, GiseAssinaturaRelatorio } from '$lib/server/schema';
	import { loading } from '$lib/loading.svelte';
	import SearchableSelect from '$lib/components/SearchableSelect.svelte';
	import ModalRemoverSeccional from './modais/ModalRemoverSeccional.svelte';
	import { useGiseSeccionalActions } from '$lib/composables/gise';
	import {
		checkAllSigned,
		getFaltandoRubrica,
		getSeccionalColorClass,
		tiposEquipeNaSeccional
	} from '$lib/gise/gise-page-helpers';
	import { validarHora, normalizarHora } from '$lib/gise/gise-horarios';

	type Seccional = GiseDetalhado['seccionais'][number];

	interface Props {
		sec: Seccional;
		gise: GiseDetalhado;
		todasUnidades: Unidade[];
		isAdminGeral: boolean;
		isSeccional: boolean;
		isSupervisor: boolean;
		podeEditar: boolean;
		podeDownload: boolean;
		isMobile: boolean;
		minhaSeccionalId: number | null;
		modoEdicaoGeral: boolean;
		assinaturasRelatorios: GiseAssinaturaRelatorio[] | undefined;
		restringirSmartphone: boolean;
		recolhida: boolean;
		onToggleRecolher: () => void;
		onAssinarRelatorioManual: (seccionalId: number) => void;
		onAssinarRelatorioDigital: (
			seccionalId: number,
			tipo: 'extraordinario',
			seccionalNome: string
		) => void;
		onFinalizarSuccess?: () => void;
	}

	const {
		sec,
		gise,
		todasUnidades,
		isAdminGeral,
		isSeccional,
		isSupervisor,
		podeEditar,
		podeDownload,
		isMobile,
		minhaSeccionalId,
		modoEdicaoGeral,
		assinaturasRelatorios,
		restringirSmartphone,
		recolhida,
		onToggleRecolher,
		onAssinarRelatorioManual,
		onAssinarRelatorioDigital,
		onFinalizarSuccess
	}: Props = $props();

	// Estado de UI (edição inline). Vive aqui porque é mutuamente exclusivo
	// entre as equipes/slots renderizados pelo template deste componente.
	let modoEdicaoSeccional = $state(false);

	let editandoHorariosSeccional = $state(false);
	let editSecHoraEnt = $state('');
	let editSecHoraSai = $state('');

	let editandoEquipe = $state<number | null>(null);
	let editSlotsDpc = $state(0);
	let editSlotsOip = $state(0);

	let editandoHorariosEquipeId = $state<number | null>(null);
	let editEqHoraEnt = $state('');
	let editEqHoraSai = $state('');

	let selecionandoUnidadeSlotId = $state<number | null>(null);
	let slotUnidadeId = $state<number | ''>('');

	let equipeParaAdicionar = $state<number | null>(null);
	let cargoParaAdicionar = $state<'OIP' | 'DPC' | null>(null);
	let policialParaAdicionar = $state<number | ''>('');

	let adicionandoEquipe = $state(false);
	let adicionandoEquipeSlotId = $state<number | null>(null);
	let novaEquipeTipo = $state<'operacional' | 'seint'>('operacional');
	let novaEquipeDpc = $state(1);
	let novaEquipeOip = $state(3);

	let adicionandoSlot = $state(false);
	let novoSlotUnidadeId = $state<number | ''>('');

	// CRUD: `pendingCrud`, todos os `use:enhance` handlers, fluxo do modal de
	// remover seccional e factory `buscarPorCargo` vivem no composable.
	const actions = useGiseSeccionalActions({
		onFinalizarSeccionalSuccess: () => {
			modoEdicaoSeccional = false;
			onFinalizarSuccess?.();
		},
		onSelecionarUnidadeSuccess: () => {
			selecionandoUnidadeSlotId = null;
			slotUnidadeId = '';
		},
		onAdicionarEquipeSuccess: () => {
			adicionandoEquipe = false;
			adicionandoEquipeSlotId = null;
		},
		onSalvarSlotsEquipeSuccess: () => {
			editandoEquipe = null;
		},
		onSalvarHorariosEquipeSuccess: () => {
			editandoHorariosEquipeId = null;
		},
		onSalvarHorariosSecSuccess: () => {
			editandoHorariosSeccional = false;
		},
		onAdicionarMembroSuccess: () => {
			equipeParaAdicionar = null;
			policialParaAdicionar = '';
			cargoParaAdicionar = null;
		},
		onAdicionarUnidadeSuccess: () => {
			novoSlotUnidadeId = '';
			adicionandoSlot = false;
		},
		getHorariosEquipeFormulario: () => ({
			entrada: editEqHoraEnt,
			saida: editEqHoraSai
		}),
		getHorariosSecFormulario: () => ({
			entrada: editSecHoraEnt,
			saida: editSecHoraSai
		})
	});

	const pendingCrud = $derived(actions.pendingCrud);
	const pendingFinalizar = $derived(actions.pendingFinalizarSeccional);
	const pendingSelecionarUnidade = $derived(actions.pendingSelecionarUnidade);
	const pendingAdicionarEquipe = $derived(actions.pendingAdicionarEquipe);
	const pendingRemoverEquipe = $derived(actions.pendingRemoverEquipe);
	const pendingSalvarSlotsEquipe = $derived(actions.pendingSalvarSlotsEquipe);
	const pendingAdicionarUnidade = $derived(actions.pendingAdicionarUnidade);
	const pendingRemoverUnidade = $derived(actions.pendingRemoverUnidade);
	const pendingSalvarHorariosEquipe = $derived(actions.pendingSalvarHorariosEquipe);
	const pendingSalvarHorariosSec = $derived(actions.pendingSalvarHorariosSec);
	const pendingAdicionarMembro = $derived(actions.pendingAdicionarMembro);
	const pendingRemoverMembro = $derived(actions.pendingRemoverMembro);
	const pendingRemoverSeccional = $derived(actions.pendingRemoverSeccional);

	const buscarMembroAdicional = $derived(
		cargoParaAdicionar ? actions.buscarPorCargo(cargoParaAdicionar) : undefined
	);
</script>

{#snippet statusBadge(status: string, isSeccionalBadge = false)}
	{#if isSeccionalBadge}
		<span
			class="text-sm px-1.5 py-0.5 rounded-full font-bold {status === 'preenchida' ||
			status === 'preenchida_retificada'
				? 'bg-success-500/20 text-success-700 dark:text-success-400'
				: status === 'retificada'
					? 'bg-warning-500/20 text-warning-600 dark:text-warning-400 border border-warning-500/40'
					: 'bg-surface-500/20 text-surface-600 dark:text-surface-400'}"
		>
			{status === 'preenchida'
				? 'Preenchida'
				: status === 'preenchida_retificada'
					? 'Preenchida (Retificada)'
					: status === 'retificada'
						? 'Preenchida (Retificada)'
						: 'Pendente'}
		</span>
	{/if}
{/snippet}

{#snippet btnIcon(path: string)}
	<svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
		<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d={path} />
	</svg>
{/snippet}

{#snippet actionButton(
	label: string,
	iconPath?: string,
	variant = 'primary',
	type = 'outlined',
	onclick?: () => void,
	href?: string,
	disabled = false,
	isLoadingLoc = false,
	classes = '',
	btnType: 'button' | 'submit' = 'button',
	size = 'sm'
)}
	{@const baseClass = `btn btn-${size} preset-${type}-${variant}-500 rounded-lg font-semibold min-w-0 max-w-full text-center whitespace-normal sm:whitespace-nowrap transition-all flex items-center justify-center gap-1.5 ${classes}`}
	{#if href}
		<a class="{baseClass} no-underline" {href} target="_blank">
			{#if iconPath}{@render btnIcon(iconPath)}{/if}
			{label}
		</a>
	{:else}
		<button
			class={baseClass}
			{onclick}
			disabled={disabled || loading.active || pendingCrud || isLoadingLoc}
			type={btnType}
		>
			{#if iconPath}
				{@render btnIcon(iconPath)}
			{/if}
			{label}
		</button>
	{/if}
{/snippet}

{#snippet seccionalRelatoriosDownloads(compact: boolean)}
	{#if podeDownload}
		{@const assRel = assinaturasRelatorios?.find(
			(a: GiseAssinaturaRelatorio) =>
				(a.seccional_id === sec.seccional_id || a.seccional_id === sec.id) &&
				a.tipo === 'extraordinario'
		)}
		{@const tiposProd = tiposEquipeNaSeccional(sec)}
		<div
			class={compact
				? 'flex w-full min-w-0 flex-col gap-2'
				: 'flex w-full min-w-0 flex-row flex-wrap items-center justify-start gap-2 sm:gap-2.5 lg:flex-1'}
		>
			{#each tiposProd as tipo (tipo)}
				{@const hrefProd = `/api/gise/${gise.id}/download?format=produtividade&seccionalId=${sec.seccional_id}&equipeType=${tipo}`}
				{@const rótuloProd = tipo === 'seint' ? 'Prod. SEINT' : 'Prod. Op.'}
				{#if sec.temRespostas}
					<a
						class="btn text-xs font-bold px-3 py-2 rounded-xl border-2 border-success-500/35 hover:border-success-500 preset-outlined-success-500 max-w-full justify-center no-underline inline-flex items-center gap-1.5 transition-all {compact
							? 'w-full'
							: 'w-auto'}"
						href={hrefProd}
						target="_blank"
						rel="noopener noreferrer"
						title="Baixar {rótuloProd === 'Prod. SEINT'
							? 'produtividade SEINT'
							: 'produtividade operacional'}"
					>
						<svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"
							><path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
							/></svg
						>
						<span class="shrink-0">{rótuloProd}</span>
					</a>
				{:else}
					<button
						type="button"
						class="btn text-xs font-bold px-3 py-2 rounded-xl border-2 max-w-full inline-flex items-center justify-center gap-1.5 select-none border-surface-300/80 bg-surface-100/90 text-surface-600 shadow-sm cursor-not-allowed dark:border-surface-600 dark:bg-surface-800/50 dark:text-surface-400 {compact
							? 'w-full'
							: 'w-full xs:w-auto sm:w-auto'}"
						disabled
						title="Aguardando preenchimento do formulário de produtividade desta seccional"
					>
						<svg
							class="w-4 h-4 shrink-0 opacity-90"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
							><path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
							/></svg
						>
						<span class="shrink-0">{rótuloProd}</span>
						<span class="text-3xs font-medium italic">(aguardando)</span>
					</button>
				{/if}
			{/each}

			<div
				class={compact
					? 'flex w-full flex-col gap-2'
					: 'flex w-full xs:w-auto xs:max-w-full xs:shrink-0 flex-col xs:flex-row xs:flex-wrap xs:items-center gap-2'}
			>
				{#if assRel}
					<div class="flex gap-2 {compact ? 'w-full' : 'w-full xs:w-auto'}">
						<a
							class="btn flex-1 text-xs font-bold px-2 py-2 rounded-xl border-2 no-underline flex items-center justify-center gap-1.5 transition-all preset-filled-primary-500 border-primary-600/30 hover:border-primary-600"
							href={`/api/gise/${gise.id}/download?format=extraordinario&seccionalId=${sec.seccional_id}`}
							target="_blank"
							rel="noopener noreferrer"
							title={`Sem manifesto — assinado por ${assRel.assinante_nome}`}
						>
							<svg class="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"
								><path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
								/></svg
							>
							<span class="whitespace-nowrap">S/ manifesto</span>
						</a>
						<a
							class="btn flex-1 text-xs font-bold px-2 py-2 rounded-xl border-2 no-underline flex items-center justify-center gap-1.5 transition-all preset-outlined-primary-500 border-primary-500/30 hover:border-primary-500"
							href={`/api/gise/${gise.id}/download?format=extraordinario&seccionalId=${sec.seccional_id}&manifesto=true`}
							target="_blank"
							rel="noopener noreferrer"
							title="Com manifesto — inclui folha de auditoria"
						>
							<svg class="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"
								><path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
								/></svg
							>
							<span class="whitespace-nowrap">C/ manifesto</span>
						</a>
					</div>
				{:else}
					<a
						class="btn text-xs font-bold px-3 py-2 rounded-xl border-2 flex items-center justify-center gap-2 transition-all {!(
							checkAllSigned(sec) &&
							(isAdminGeral || isSeccional || isSupervisor)
						)
							? 'pointer-events-none opacity-60 border-primary-500/30'
							: 'no-underline'} preset-tonal-primary border-primary-500/30 hover:border-primary-500 {compact
							? 'w-full'
							: 'w-full xs:w-auto'}"
						href={`/api/gise/${gise.id}/download?format=extraordinario&seccionalId=${sec.seccional_id}`}
						target="_blank"
						rel="noopener noreferrer"
						title={!checkAllSigned(sec)
							? getFaltandoRubrica(sec)
							: 'Aguardando assinatura do supervisor (escala)'}
					>
						<svg class="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"
							><path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
							/></svg
						>
						<span class="whitespace-nowrap">Relat. Extra</span>
						<span class="text-3xs opacity-100 dark:opacity-80 font-normal italic ml-1"
							>({!checkAllSigned(sec) ? 'não concluído' : 'conferência'})</span
						>
					</a>
				{/if}
				{#if isSupervisor && !assRel && checkAllSigned(sec)}
					<div
						class={compact
							? 'flex w-full flex-col gap-2'
							: 'flex w-full xs:w-auto flex-col xs:flex-row items-stretch xs:items-center gap-2'}
					>
						{#if isMobile || !restringirSmartphone}
							{@render actionButton(
								'Ass. tela',
								'M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z',
								'warning',
								'filled',
								() => onAssinarRelatorioManual(sec.seccional_id),
								undefined,
								false,
								false,
								compact
									? 'border-2 border-warning-600/30 hover:border-warning-600 text-3xs py-2 shadow-sm font-bold uppercase w-full min-h-11 touch-manipulation shrink-0'
									: 'border-2 border-warning-600/30 hover:border-warning-600 text-3xs py-1.5 sm:py-1 shadow-sm font-bold uppercase w-full xs:w-auto min-h-11 sm:min-h-0 touch-manipulation shrink-0',
								'button',
								'xs'
							)}
						{/if}

						{#if !isMobile}
							{@render actionButton(
								'Ass. token',
								'M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z',
								'tertiary',
								'filled',
								() =>
									onAssinarRelatorioDigital(sec.seccional_id, 'extraordinario', sec.seccional_nome),
								undefined,
								false,
								false,
								compact
									? 'border-2 border-tertiary-600/30 hover:border-tertiary-600 text-3xs py-2 shadow-sm font-bold uppercase w-full min-h-11 touch-manipulation shrink-0'
									: 'border-2 border-tertiary-600/30 hover:border-tertiary-600 text-3xs py-1.5 sm:py-1 shadow-sm font-bold uppercase w-full xs:w-auto min-h-11 sm:min-h-0 touch-manipulation shrink-0',
								'button',
								'xs'
							)}
						{/if}
					</div>
				{/if}
			</div>
		</div>
	{/if}
{/snippet}

<div
	class="rounded-2xl border-2 border-surface-300 dark:border-surface-700 border-l-[6px] mb-4 overflow-hidden {getSeccionalColorClass(
		sec.seccional_id
	)} shadow-sm hover:shadow-md transition-shadow duration-300"
>
	<!-- Cabeçalho da seccional -->
	<div
		class="flex flex-wrap items-center gap-2 justify-between px-4 sm:px-5 py-3 {recolhida
			? ''
			: 'border-b border-surface-200/40 dark:border-surface-700/40'}"
	>
		<div class="flex-1 min-w-0 flex flex-wrap items-center gap-y-1">
			<button
				type="button"
				class="flex items-center gap-x-3 text-left active:scale-[0.99] transition-transform min-w-0"
				onclick={onToggleRecolher}
			>
				<div
					class="p-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors shrink-0"
				>
					<svg
						class="w-5 h-5 transition-transform duration-300 {recolhida ? '-rotate-90' : ''}"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M19 9l-7 7-7-7"
						/>
					</svg>
				</div>
				<span
					class="font-bold text-surface-900 dark:text-surface-50 text-sm sm:text-base truncate mr-2"
				>
					{sec.seccional_nome}
				</span>
				{@render statusBadge(sec.status, true)}
			</button>

			{#if editandoHorariosSeccional}
				<div class="flex flex-wrap items-center gap-2 ml-2">
					<input
						type="text"
						placeholder="08:00"
						class="w-16 px-2 py-1 text-sm rounded border bg-white dark:bg-surface-900 {editSecHoraEnt &&
						!validarHora(editSecHoraEnt)
							? 'border-error-500'
							: 'border-surface-300 dark:border-surface-600'}"
						bind:value={editSecHoraEnt}
					/>
					<span class="opacity-30">-</span>
					<input
						type="text"
						placeholder="16:00"
						class="w-16 px-2 py-1 text-sm rounded border bg-white dark:bg-surface-900 {editSecHoraSai &&
						!validarHora(editSecHoraSai)
							? 'border-error-500'
							: 'border-surface-300 dark:border-surface-600'}"
						bind:value={editSecHoraSai}
					/>
					<div class="flex items-center gap-2 shrink-0">
						<form
							method="POST"
							action="?/salvarHorariosSec"
							use:enhance={actions.handleSalvarHorariosSec}
							class="contents"
						>
							<input type="hidden" name="secId" value={sec.id} />
							<input
								type="hidden"
								name="hora_entrada"
								value={normalizarHora(editSecHoraEnt) ?? ''}
							/>
							<input type="hidden" name="hora_saida" value={normalizarHora(editSecHoraSai) ?? ''} />
							<button
								type="submit"
								class="btn btn-sm preset-filled-primary-500 text-sm py-1 px-2 rounded transition-all"
								disabled={pendingCrud}
								title="Confirmar">{pendingSalvarHorariosSec ? '…' : '✓'}</button
							>
						</form>
						<button
							type="button"
							class="btn btn-sm preset-outlined-primary-500 text-sm py-1 px-2 rounded"
							onclick={() => (editandoHorariosSeccional = false)}>×</button
						>
					</div>
				</div>
			{:else}
				<div
					class="flex items-center gap-1.5 text-xs sm:text-sm text-surface-500 font-medium sm:ml-2"
				>
					<span>{sec.hora_entrada ?? gise.hora_entrada}h-{sec.hora_saida ?? gise.hora_saida}h</span>
					{#if (sec.hora_entrada || sec.hora_saida) && !recolhida}
						<span
							class="hidden sm:inline-block ml-1 px-1 rounded bg-warning-500/10 text-warning-600 dark:text-warning-400 font-bold border border-warning-500/20 text-3xs"
							>H. Personalizado</span
						>
					{/if}

					{#if podeEditar && ((isAdminGeral && modoEdicaoGeral) || (isSeccional && sec.seccional_id === minhaSeccionalId && (modoEdicaoSeccional || sec.status === 'pendente' || sec.status === 'retificada')))}
						<button
							type="button"
							class="btn btn-xs preset-filled-surface-500 rounded p-1 shrink-0 ml-1"
							onclick={(e) => {
								e.stopPropagation();
								editandoHorariosSeccional = true;
								editSecHoraEnt = sec.hora_entrada ?? gise.hora_entrada ?? '';
								editSecHoraSai = sec.hora_saida ?? gise.hora_saida ?? '';
							}}
							title="Editar horários da seccional"
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
		</div>

		{#if isAdminGeral && podeEditar && modoEdicaoGeral}
			<div class="hidden shrink-0 items-start sm:flex">
				<form
					method="POST"
					action="?/removerSeccional"
					use:enhance={actions.handleRemoverSeccionalForm}
					class="block"
				>
					<input type="hidden" name="secId" value={sec.id} />
					<button
						type="submit"
						class="btn btn-sm preset-outlined-error-500 flex w-auto items-center justify-center gap-1 whitespace-nowrap"
						disabled={pendingCrud}
						title="Excluir seccional desta escala"
					>
						<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"
							><path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
							/></svg
						>
						Excluir seccional
					</button>
				</form>
			</div>
		{/if}
	</div>

	{#if !recolhida}
		{#if podeDownload || (isAdminGeral && podeEditar && modoEdicaoGeral)}
			<Accordion collapsible class="border-b border-surface-200 dark:border-surface-700 sm:hidden">
				<Accordion.Item value="downloads">
					<Accordion.ItemTrigger
						class="flex w-full cursor-pointer items-center justify-center px-4 py-2.5 text-sm text-surface-700 hover:bg-surface-100/90 dark:text-surface-200 dark:hover:bg-surface-800/50"
					>
						<span class="inline-flex items-center gap-1.5 font-semibold">
							Downloads da Seccional
							<Accordion.ItemIndicator>
								<svg
									class="h-4 w-4 shrink-0 text-surface-500 transition-transform"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
									aria-hidden="true"
								>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M19 9l-7 7-7-7"
									/>
								</svg>
							</Accordion.ItemIndicator>
						</span>
					</Accordion.ItemTrigger>
					<Accordion.ItemContent
						class="flex flex-col gap-2 border-t border-surface-200/80 px-4 pb-3 pt-2 dark:border-surface-700"
					>
						{@render seccionalRelatoriosDownloads(true)}
					</Accordion.ItemContent>
				</Accordion.Item>
			</Accordion>

			{#if isAdminGeral && podeEditar && modoEdicaoGeral}
				<Accordion
					collapsible
					class="border-b border-surface-200 dark:border-surface-700 sm:hidden"
				>
					<Accordion.Item value="opcoes">
						<Accordion.ItemTrigger
							class="flex w-full cursor-pointer items-center justify-center px-4 py-2.5 text-sm text-surface-700 hover:bg-surface-100/90 dark:text-surface-200 dark:hover:bg-surface-800/50"
						>
							<span class="inline-flex items-center gap-1.5 font-semibold">
								Opções da Seccional
								<Accordion.ItemIndicator>
									<svg
										class="h-4 w-4 shrink-0 text-surface-500 transition-transform"
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M19 9l-7 7-7-7"
										/>
									</svg>
								</Accordion.ItemIndicator>
							</span>
						</Accordion.ItemTrigger>
						<Accordion.ItemContent
							class="flex flex-col gap-2 border-t border-surface-200/80 px-4 pb-3 pt-2 dark:border-surface-700"
						>
							<form
								method="POST"
								action="?/removerSeccional"
								use:enhance={actions.handleRemoverSeccionalForm}
								class="block w-full"
							>
								<input type="hidden" name="secId" value={sec.id} />
								<button
									type="submit"
									class="btn btn-sm preset-outlined-error-500 flex w-full items-center justify-center gap-1 whitespace-nowrap"
									disabled={pendingCrud}
								>
									<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"
										><path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
										/></svg
									>
									Excluir seccional
								</button>
							</form>

							<button
								type="button"
								class="btn btn-sm preset-outlined-primary-500 w-full flex items-center justify-center gap-1 whitespace-nowrap"
								onclick={() => {
									adicionandoSlot = true;
									novoSlotUnidadeId = '';
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
								+ Adicionar + DP(s) nesta Seccional
							</button>
						</Accordion.ItemContent>
					</Accordion.Item>
				</Accordion>
			{/if}
		{/if}

		<!-- Ações Seccional & Downloads -->
		<div
			class="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3 lg:gap-4 px-4 sm:px-5 pb-3 border-b border-surface-200 dark:border-surface-700"
		>
			{#if podeDownload}
				<div class="max-sm:hidden w-full min-w-0">
					{@render seccionalRelatoriosDownloads(false)}
				</div>
			{/if}

			<div
				class="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full shrink-0 lg:w-auto lg:ml-auto {podeDownload
					? 'border-t border-surface-200/70 pt-3 dark:border-surface-700 lg:border-t-0 lg:pt-0'
					: ''}"
			>
				{#if isSeccional && sec.seccional_id === minhaSeccionalId && podeEditar}
					{#if sec.status === 'preenchida' && !modoEdicaoSeccional}
						{@render actionButton(
							'Editar Escala',
							undefined,
							'primary',
							'filled',
							() => (modoEdicaoSeccional = true),
							undefined,
							false,
							false,
							'border-2 border-primary-600/30 hover:border-primary-600 px-4 py-1.5 shadow-sm text-sm w-full'
						)}
					{:else}
						<form
							method="POST"
							action="?/finalizarSeccional"
							use:enhance={actions.handleFinalizarSeccional}
							class="contents"
						>
							<input type="hidden" name="secId" value={sec.id} />
							<button
								type="submit"
								class="text-sm btn preset-filled-success-500 border-2 border-success-600/30 hover:border-success-600 px-4 py-1.5 rounded-lg shadow-sm disabled:opacity-50 disabled:cursor-not-allowed transition-all font-bold w-full"
								disabled={pendingCrud ||
									(sec.unidades ?? []).length === 0 ||
									(sec.unidades ?? []).some((s: GiseUnidadeSlot) => s.unidade_id === null) ||
									(sec.unidades ?? []).some(
										(s: GiseUnidadeSlot) =>
											!(s.equipes ?? []).some(
												(eq: GiseEquipeComMembros) => (eq.membros ?? []).length > 0
											)
									)}
								title={(sec.unidades ?? []).length === 0
									? 'Adicione ao menos uma unidade antes de finalizar'
									: (sec.unidades ?? []).some((s: GiseUnidadeSlot) => s.unidade_id === null)
										? 'Todos os slots devem ter uma unidade selecionada'
										: (sec.unidades ?? []).some(
													(s: GiseUnidadeSlot) =>
														!(s.equipes ?? []).some(
															(eq: GiseEquipeComMembros) => (eq.membros ?? []).length > 0
														)
											  )
											? 'Cada unidade deve ter pelo menos 1 policial alocado'
											: ''}
							>
								{#if pendingFinalizar}
									{sec.status === 'preenchida'
										? 'Finalizando edição...'
										: sec.status === 'retificada'
											? 'Confirmando...'
											: 'Enviando escala...'}
								{:else}
									{sec.status === 'preenchida'
										? 'Finalizar edição'
										: sec.status === 'retificada'
											? 'Confirmar retificação'
											: 'Finalizar envio'}
								{/if}
							</button>
						</form>

						{#if modoEdicaoSeccional}
							<button
								type="button"
								class="btn btn-sm preset-outlined-surface-500 border-2 border-surface-300/60 text-sm font-semibold px-4 py-2 rounded-lg w-full sm:w-auto hover:bg-surface-50 dark:border-surface-600 dark:hover:bg-surface-900 transition-colors"
								onclick={() => {
									modoEdicaoSeccional = false;
									selecionandoUnidadeSlotId = null;
									equipeParaAdicionar = null;
									cargoParaAdicionar = null;
								}}
							>
								Cancelar edição
							</button>
						{/if}
					{/if}
				{/if}
			</div>
		</div>

		<div class="p-3 sm:p-4 space-y-3">
			<!-- Slots de Unidade -->
			{#each sec.unidades ?? [] as slot (slot.id)}
				{@const podeEditarCabecalhoUnidade =
					(isSeccional &&
						sec.seccional_id === minhaSeccionalId &&
						(modoEdicaoSeccional || sec.status === 'pendente' || sec.status === 'retificada')) ||
					(isAdminGeral && podeEditar && modoEdicaoGeral)}
				<div
					class="rounded-xl border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-950 overflow-visible shadow-[inset_0_1px_3px_rgba(0,0,0,0.02)]"
				>
					<!-- Cabeçalho do slot -->
					<div
						class="flex flex-col gap-2 px-4 py-3 border-b border-surface-200 dark:border-surface-800"
					>
						{#if podeEditarCabecalhoUnidade && selecionandoUnidadeSlotId === slot.id}
							<div class="flex flex-col sm:flex-row gap-2 w-full min-w-0 sm:items-center">
								<div class="w-full flex-1">
									<select
										bind:value={slotUnidadeId}
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
										<input type="hidden" name="unidadeId" value={slotUnidadeId} />
										<button
											type="submit"
											class="btn preset-filled-primary-500 text-sm px-4 py-1.5 rounded-xl w-full sm:w-auto sm:px-6 transition-all font-semibold"
											disabled={!slotUnidadeId || pendingCrud}
										>
											{pendingSelecionarUnidade ? 'Salvando...' : 'Confirmar'}
										</button>
									</form>
									<button
										type="button"
										class="btn preset-outlined-primary-500 text-sm px-4 py-1.5 rounded-xl flex-1 sm:flex-initial sm:w-auto sm:px-6 font-semibold"
										onclick={() => {
											selecionandoUnidadeSlotId = null;
											slotUnidadeId = '';
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
											disabled={pendingCrud}
										>
											<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"
												><path
													stroke-linecap="round"
													stroke-linejoin="round"
													stroke-width="2"
													d="M6 18L18 6M6 6l12 12"
												/></svg
											>
											{pendingRemoverUnidade ? 'Removendo...' : 'Remover DP'}
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
												selecionandoUnidadeSlotId = slot.id;
												slotUnidadeId = slot.unidade_id ?? '';
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
											disabled={pendingCrud}
										>
											<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"
												><path
													stroke-linecap="round"
													stroke-linejoin="round"
													stroke-width="2"
													d="M6 18L18 6M6 6l12 12"
												/></svg
											>
											{pendingRemoverUnidade ? 'Removendo...' : 'Remover DP'}
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
										selecionandoUnidadeSlotId = slot.id;
										slotUnidadeId = '';
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
											disabled={pendingCrud}
										>
											<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"
												><path
													stroke-linecap="round"
													stroke-linejoin="round"
													stroke-width="2"
													d="M6 18L18 6M6 6l12 12"
												/></svg
											>
											{pendingRemoverUnidade ? 'Removendo...' : 'Remover DP'}
										</button>
									</form>
								{/if}
							</div>
						{:else}
							<span class="text-sm text-surface-500 dark:text-surface-400 italic"
								>Unidade não definida</span
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
							<div
								class="flex-1 rounded-xl border border-surface-200 dark:border-surface-700/60 p-3 sm:p-4 bg-white dark:bg-surface-900 shadow-sm hover:shadow-md transition-shadow duration-200"
							>
								<div
									class="mb-3 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between lg:gap-4"
								>
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
												disabled={pendingCrud}
											>
												{pendingRemoverEquipe ? 'Removendo...' : 'Remover equipe'}
											</button>
										{/if}
									</div>

									<div
										class="flex min-w-0 flex-1 gap-2 lg:flex-row lg:flex-wrap lg:items-center lg:justify-end lg:gap-x-3 lg:gap-y-2 {editandoEquipe ===
											equipe.id || editandoHorariosEquipeId === equipe.id
											? 'flex-col'
											: 'flex-row flex-wrap items-center'}"
									>
										{#if editandoEquipe === equipe.id}
											<div class="flex flex-wrap items-center gap-1.5">
												<label for="edit-dpc-{equipe.id}" class="text-sm text-surface-500"
													>DPC:</label
												>
												<input
													id="edit-dpc-{equipe.id}"
													type="number"
													min="0"
													max="20"
													bind:value={editSlotsDpc}
													class="w-14 px-2 py-1 rounded-xl border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-800 text-sm text-center"
												/>
												<label for="edit-oip-{equipe.id}" class="text-sm text-surface-500"
													>OIP:</label
												>
												<input
													id="edit-oip-{equipe.id}"
													type="number"
													min="0"
													max="20"
													bind:value={editSlotsOip}
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
														<input type="hidden" name="slots_dpc" value={editSlotsDpc} />
														<input type="hidden" name="slots_oip" value={editSlotsOip} />
														<button
															type="submit"
															class="btn btn-sm preset-filled-primary-500 text-sm py-1 px-2 rounded transition-all"
															disabled={pendingCrud}
															aria-label="Salvar vagas"
															title="Confirmar">{pendingSalvarSlotsEquipe ? '…' : '✓'}</button
														>
													</form>
													<button
														type="button"
														class="btn btn-sm preset-outlined-primary-500 text-sm py-1 px-2 rounded"
														onclick={() => (editandoEquipe = null)}
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
															editandoEquipe = equipe.id;
															editSlotsDpc = equipe.slots_dpc;
															editSlotsOip = equipe.slots_oip;
														}}
														title="Editar vagas da equipe"
													>
														<svg
															class="w-3 h-3"
															fill="none"
															stroke="currentColor"
															viewBox="0 0 24 24"
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

										{#if editandoHorariosEquipeId === equipe.id}
											<div class="flex flex-wrap items-center gap-2">
												<input
													type="text"
													placeholder="08:00"
													class="w-16 px-2 py-1 text-sm rounded border bg-white dark:bg-surface-900 {editEqHoraEnt &&
													!validarHora(editEqHoraEnt)
														? 'border-error-500'
														: 'border-surface-300 dark:border-surface-600'}"
													bind:value={editEqHoraEnt}
												/>
												<span class="opacity-30">-</span>
												<input
													type="text"
													placeholder="16:00"
													class="w-16 px-2 py-1 text-sm rounded border bg-white dark:bg-surface-900 {editEqHoraSai &&
													!validarHora(editEqHoraSai)
														? 'border-error-500'
														: 'border-surface-300 dark:border-surface-600'}"
													bind:value={editEqHoraSai}
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
															value={normalizarHora(editEqHoraEnt) ?? ''}
														/>
														<input
															type="hidden"
															name="hora_saida"
															value={normalizarHora(editEqHoraSai) ?? ''}
														/>
														<button
															type="submit"
															class="btn btn-sm preset-filled-primary-500 text-sm py-1 px-2 rounded transition-all"
															disabled={pendingCrud}
															title="Confirmar">{pendingSalvarHorariosEquipe ? '…' : '✓'}</button
														>
													</form>
													<button
														type="button"
														class="btn btn-sm preset-outlined-primary-500 text-sm py-1 px-2 rounded"
														onclick={() => (editandoHorariosEquipeId = null)}>×</button
													>
												</div>
											</div>
										{:else}
											<div class="flex flex-wrap items-center gap-2 min-w-0">
												<div
													class="flex flex-wrap items-center gap-1.5 text-sm text-surface-500 dark:text-surface-400 font-medium min-w-0"
												>
													<span
														>{equipe.hora_entrada ??
															sec.hora_entrada ??
															gise.hora_entrada}h-{equipe.hora_saida ??
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
															editandoHorariosEquipeId = equipe.id;
															editEqHoraEnt =
																equipe.hora_entrada ?? sec.hora_entrada ?? gise.hora_entrada ?? '';
															editEqHoraSai =
																equipe.hora_saida ?? sec.hora_saida ?? gise.hora_saida ?? '';
														}}
														title="Editar horários da equipe"
													>
														<svg
															class="w-3 h-3"
															fill="none"
															stroke="currentColor"
															viewBox="0 0 24 24"
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
												disabled={pendingCrud}
											>
												{pendingRemoverEquipe ? 'Removendo...' : 'Remover equipe'}
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
													<span class="text-surface-500"
														>{m.policial_cargo} · {m.policial_matricula}</span
													>
													{#if m.presenca?.entrada_timestamp && m.presenca?.saida_timestamp}
														<span
															class="text-xs px-1 py-0.5 rounded bg-success-500/20 text-success-700 dark:text-success-400"
															>✓</span
														>
													{:else if m.presenca?.entrada_timestamp}
														<span
															class="text-xs px-1 py-0.5 rounded bg-warning-500/20 text-warning-700 dark:text-warning-400"
															>Entrada</span
														>
													{/if}
												</div>
												{#if podeEditar && ((isAdminGeral && modoEdicaoGeral) || (isSeccional && sec.seccional_id === minhaSeccionalId && (modoEdicaoSeccional || sec.status === 'pendente' || sec.status === 'retificada')))}
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
															disabled={pendingCrud}
														>
															{#if pendingRemoverMembro}…{:else}×{/if}
														</button>
													</form>
												{/if}
											</div>
										{/each}
									</div>
								{:else}
									<p class="text-sm text-surface-500 dark:text-surface-400 italic mb-3">
										Nenhum membro alocado
									</p>
								{/if}

								<!-- Adicionar membro -->
								{#if podeEditar && ((isAdminGeral && modoEdicaoGeral) || (isSeccional && sec.seccional_id === minhaSeccionalId && (modoEdicaoSeccional || sec.status === 'pendente' || sec.status === 'retificada')))}
									{#if equipeParaAdicionar === equipe.id}
										<form
											method="POST"
											action="?/adicionarMembro"
											use:enhance={actions.handleAdicionarMembro}
										>
											<input type="hidden" name="secId" value={sec.id} />
											<input type="hidden" name="equipe_id" value={equipeParaAdicionar} />
											<input type="hidden" name="policial_id" value={policialParaAdicionar} />
											<div class="flex flex-col sm:flex-row gap-2 sm:items-end">
												<div class="w-full flex-1 min-w-32">
													{#key cargoParaAdicionar}
														<SearchableSelect
															bind:value={policialParaAdicionar}
															loadOptions={buscarMembroAdicional}
															placeholder={`Pesquisar ${cargoParaAdicionar}...`}
															class="w-full"
														/>
													{/key}
												</div>
												<div class="w-full sm:w-auto flex gap-2">
													<button
														type="submit"
														class="btn preset-filled-primary-500 text-sm px-3 py-1.5 rounded-lg flex-1 sm:flex-none transition-all"
														disabled={!policialParaAdicionar || pendingCrud}
														>{pendingAdicionarMembro ? 'Adicionando...' : 'Adicionar'}</button
													>
													<button
														type="button"
														class="btn preset-outlined-primary-500 text-sm px-3 py-1.5 rounded-lg flex-1 sm:flex-none"
														onclick={() => {
															equipeParaAdicionar = null;
															policialParaAdicionar = '';
															cargoParaAdicionar = null;
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
													equipeParaAdicionar = equipe.id;
													cargoParaAdicionar = 'OIP';
													policialParaAdicionar = '';
												}}
											>
												<svg
													class="w-3.5 h-3.5"
													fill="none"
													stroke="currentColor"
													viewBox="0 0 24 24"
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
														equipeParaAdicionar = equipe.id;
														cargoParaAdicionar = 'DPC';
														policialParaAdicionar = '';
													}}
												>
													<svg
														class="w-3.5 h-3.5"
														fill="none"
														stroke="currentColor"
														viewBox="0 0 24 24"
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
						{/each}
					</div>

					<!-- Admin Geral: adicionar equipe a este slot -->
					{#if isAdminGeral && podeEditar && modoEdicaoGeral}
						<div class="px-3 pb-3 flex justify-start">
							{#if adicionandoEquipe && adicionandoEquipeSlotId === slot.id}
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
											bind:value={novaEquipeTipo}
											onchange={() => {
												if (novaEquipeTipo === 'operacional') {
													novaEquipeDpc = 1;
													novaEquipeOip = 3;
												} else {
													novaEquipeDpc = 0;
													novaEquipeOip = 2;
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
											bind:value={novaEquipeDpc}
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
											bind:value={novaEquipeOip}
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
										<input type="hidden" name="tipo" value={novaEquipeTipo} />
										<input type="hidden" name="slots_dpc" value={novaEquipeDpc} />
										<input type="hidden" name="slots_oip" value={novaEquipeOip} />
										<button
											type="submit"
											class="btn preset-filled-primary-500 text-sm px-3 py-1.5 rounded-lg transition-all"
											disabled={pendingCrud}
											>{pendingAdicionarEquipe ? 'Adicionando...' : 'Adicionar'}</button
										>
									</form>
									<button
										type="button"
										class="btn preset-outlined-surface-500 text-sm px-2 py-1.5 rounded-lg"
										onclick={() => {
											adicionandoEquipe = false;
											adicionandoEquipeSlotId = null;
										}}>Cancelar</button
									>
								</div>
							{:else}
								<button
									type="button"
									class="btn btn-sm preset-outlined-success-500 w-auto flex items-center justify-center gap-1 whitespace-nowrap mt-1"
									onclick={() => {
										adicionandoEquipe = true;
										adicionandoEquipeSlotId = slot.id;
										novaEquipeTipo = 'operacional';
										novaEquipeDpc = 1;
										novaEquipeOip = 3;
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
			{/each}

			<!-- Admin Geral: adicionar slot de unidade -->
			{#if isAdminGeral && podeEditar && modoEdicaoGeral}
				{#if adicionandoSlot}
					<div
						class="flex flex-wrap gap-2 items-end p-3 rounded-xl border border-dashed border-primary-400/50 bg-primary-500/5"
					>
						<div class="flex-1 min-w-40">
							<label
								for="novo-slot-unidade-{sec.id}"
								class="text-xs font-medium text-surface-600 dark:text-surface-400 block mb-1"
								>Unidade (opcional — pode deixar em branco)</label
							>
							<select
								id="novo-slot-unidade-{sec.id}"
								bind:value={novoSlotUnidadeId}
								class="w-full px-2 py-1.5 rounded-xl border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-800 text-sm"
							>
								<option value="">Slot em branco (Adm Seccional preenche depois)</option>
								{#each todasUnidades.filter((d: Unidade) => d.tipo === 'delegacia' && d.seccional_id === sec.seccional_id && !(sec.unidades ?? []).some((s: GiseUnidadeSlot) => s.unidade_id === d.id)) as d (d.id)}
									<option value={d.id}>{d.nome}</option>
								{/each}
							</select>
						</div>
						<form
							method="POST"
							action="?/adicionarUnidade"
							use:enhance={actions.handleAdicionarUnidade}
							class="flex gap-2 shrink-0"
						>
							<input type="hidden" name="secId" value={sec.id} />
							<input type="hidden" name="unidadeId" value={novoSlotUnidadeId} />
							<button
								type="submit"
								class="btn preset-filled-primary-500 text-sm px-3 py-1.5 rounded-xl transition-all"
								disabled={pendingCrud}
								>{pendingAdicionarUnidade ? 'Adicionando...' : 'Confirmar'}</button
							>
						</form>
						<button
							type="button"
							class="btn preset-outlined-surface-500 text-sm px-3 py-1.5 rounded-xl"
							onclick={() => {
								adicionandoSlot = false;
								novoSlotUnidadeId = '';
							}}>Cancelar</button
						>
					</div>
				{:else}
					<button
						type="button"
						class="btn preset-outlined-primary-500 text-sm px-3 py-1.5 rounded-xl border-dashed flex items-center gap-2 max-sm:hidden"
						onclick={() => {
							adicionandoSlot = true;
							novoSlotUnidadeId = '';
						}}
					>
						<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"
							><path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-2 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
							/></svg
						>
						+ Adicionar + DP(s) nesta Seccional
					</button>
				{/if}
			{/if}
		</div>
	{/if}
</div>

<ModalRemoverSeccional
	open={actions.dialogRemoverSeccionalAberto}
	pending={pendingCrud}
	onOpenChange={(open) => (actions.dialogRemoverSeccionalAberto = open)}
	onConfirm={actions.confirmarRemoverSeccional}
/>
