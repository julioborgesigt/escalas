<script lang="ts">
	/**
	 * DESIGNAÇÃO do quadro de supervisão — supervisor (DPC), assessor e os dois
	 * SEINT. Form `?/salvarSupervisores`, edição POR PAPEL e ModalShell de
	 * confirmação ao remover designação.
	 *
	 * Marcadores de entrada/saída vêm de `rodagem.ts`; os slots SEINT moram em
	 * `SupervisaoPapelSeint.svelte`.
	 */
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { tick } from 'svelte';
	import SearchableSelect from '$lib/components/SearchableSelect.svelte';
	import MarcadorPresenca from '../MarcadorPresenca.svelte';
	import PenLine from '@lucide/svelte/icons/pen-line';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import UserRound from '@lucide/svelte/icons/user-round';
	import Spinner from '$lib/components/Spinner.svelte';
	import ModalShell from '$lib/components/ModalShell.svelte';
	import SupervisaoPapelAssessor from './SupervisaoPapelAssessor.svelte';
	import SupervisaoPapelSeint from './SupervisaoPapelSeint.svelte';
	import { presencaDe } from './rodagem';
	import type {
		GiseSupervisaoGise,
		LoadOptionsFn,
		PapelSupervisao,
		PolicialOpcao,
		PresencaGiseLinha,
		SelectedOption
	} from './types';

	interface Props {
		gise: GiseSupervisaoGise;
		policiais: PolicialOpcao[];
		isAdminGeral: boolean;
		podeEditar: boolean;
		modoEdicaoGeral: boolean;
		editando: boolean;
		pendingCrud: boolean;
		buscarDpcs: LoadOptionsFn;
		buscarOips: LoadOptionsFn;
		selectedFromPoliciais: (id: number | null) => SelectedOption;
		supervisorId: number | null;
		assessorId: number | null;
		assessorEmailNotificacao?: string;
		seint1Id: number | null;
		seint2Id: number | null;
		presencasGise?: PresencaGiseLinha[] | null;
		seintSupervisaoComRelatorio?: number[];
		onEditar: () => void;
		onCancelar: () => void;
		onSubmit: SubmitFunction;
	}

	let {
		gise,
		policiais,
		isAdminGeral,
		podeEditar,
		modoEdicaoGeral,
		editando = $bindable(false),
		pendingCrud,
		buscarDpcs,
		buscarOips,
		selectedFromPoliciais,
		supervisorId = $bindable(),
		assessorId = $bindable(),
		assessorEmailNotificacao = $bindable(''),
		seint1Id = $bindable(),
		seint2Id = $bindable(),
		presencasGise = null,
		seintSupervisaoComRelatorio = [],
		onEditar,
		onCancelar,
		onSubmit
	}: Props = $props();

	const seintRelatorioSet = $derived(new Set(seintSupervisaoComRelatorio ?? []));

	let formEl = $state<HTMLFormElement | null>(null);

	type Papel = PapelSupervisao;

	let editandoPapel = $state<Papel | null>(null);
	let removendoPapel = $state<Papel | null>(null);
	let confirmarRemocaoOpen = $state(false);
	let papelParaRemover = $state<Papel | null>(null);

	/**
	 * Visão-objeto dos quatro binds de papel. Snippets não aceitam props
	 * `$bindable`, mas `bind:value={idsPapel[papel]}` em propriedade de objeto
	 * funciona — os accessors fazem proxy para as props bindables, mantendo a
	 * API do componente (e o pai) intacta.
	 */
	const idsPapel = {
		get supervisor() {
			return supervisorId;
		},
		set supervisor(v: number | null) {
			supervisorId = v;
		},
		get assessor() {
			return assessorId;
		},
		set assessor(v: number | null) {
			assessorId = v;
		},
		get seint1() {
			return seint1Id;
		},
		set seint1(v: number | null) {
			seint1Id = v;
		},
		get seint2() {
			return seint2Id;
		},
		set seint2(v: number | null) {
			seint2Id = v;
		}
	};

	/** Valor persistido (do `gise`) de cada papel, para cancelamento de edição. */
	const idPersistido: Record<Papel, () => number | null> = {
		supervisor: () => gise.supervisor_id ?? null,
		assessor: () => gise.assessor_id ?? null,
		seint1: () => gise.seint1_id ?? null,
		seint2: () => gise.seint2_id ?? null
	};

	$effect(() => {
		if (!pendingCrud) {
			removendoPapel = null;
		}
	});

	function iniciarEdicao(papel: Papel) {
		editandoPapel = papel;
		onEditar();
	}

	function cancelarEdicao() {
		if (editandoPapel) {
			idsPapel[editandoPapel] = idPersistido[editandoPapel]();
			if (editandoPapel === 'assessor') {
				assessorEmailNotificacao = gise.assessor_email_notificacao ?? '';
			}
		}
		editandoPapel = null;
		onCancelar();
	}

	function solicitarRemocao(papel: Papel) {
		papelParaRemover = papel;
		confirmarRemocaoOpen = true;
	}

	function confirmarRemocao() {
		const papel = papelParaRemover;
		if (!papel) return;

		confirmarRemocaoOpen = false;
		papelParaRemover = null;

		removendoPapel = papel;
		idsPapel[papel] = null;
		if (papel === 'assessor') {
			assessorEmailNotificacao = '';
		}

		// Garante que o estado seja atualizado nos inputs hidden antes de submeter
		// (tick() é determinístico; setTimeout(50) era uma corrida com o DOM).
		void tick().then(() => {
			if (formEl) {
				formEl.requestSubmit();
			}
		});
	}

	$effect(() => {
		editando = editandoPapel !== null;
	});

	$effect(() => {
		if (!editando) {
			editandoPapel = null;
		}
	});
</script>

<!-- Par Adicionar/Fechar da edição inline (supervisor). -->
{#snippet botoesSalvarCancelar(papel: Papel)}
	<div class="w-full grid grid-cols-2 gap-2 sm:flex sm:w-auto sm:shrink-0">
		<button
			type="submit"
			class="btn preset-filled-primary-500 text-sm px-3 py-1.5 rounded-lg w-full sm:w-auto transition-all"
			disabled={pendingCrud}
		>
			{#if pendingCrud && editandoPapel === papel}
				<Spinner size="sm" />
			{:else}
				Adicionar
			{/if}
		</button>
		<button
			type="button"
			class="btn preset-outlined-primary-500 text-sm px-3 py-1.5 rounded-lg w-full sm:w-auto"
			onclick={cancelarEdicao}
			disabled={pendingCrud}
		>
			Fechar
		</button>
	</div>
{/snippet}

<!-- Par Editar/Remover (Admin Geral). `compacto=false` = ícones 14px no supervisor. -->
{#snippet botoesEdicao(papel: Papel, temId: boolean, compacto: boolean = true)}
	{#if isAdminGeral && podeEditar && modoEdicaoGeral}
		<div class="flex items-center gap-1 shrink-0">
			<button
				type="button"
				class="btn btn-xs preset-filled-surface-500 rounded p-1"
				title="Editar"
				aria-label="Editar"
				onclick={() => iniciarEdicao(papel)}
			>
				<PenLine size={compacto ? 12 : 14} />
			</button>
			{#if temId}
				<button
					type="button"
					class="btn btn-xs preset-outlined-error-500 rounded p-1"
					title="Remover"
					aria-label="Remover"
					onclick={() => solicitarRemocao(papel)}
					disabled={pendingCrud}
				>
					{#if pendingCrud && removendoPapel === papel}
						<Spinner size="xs" />
					{:else}
						<Trash2 size={compacto ? 12 : 14} />
					{/if}
				</button>
			{/if}
		</div>
	{/if}
{/snippet}

<form
	bind:this={formEl}
	method="POST"
	action="?/salvarSupervisores"
	use:enhance={onSubmit}
	class="contents"
>
	<div
		class="p-3 sm:p-4 md:p-5 rounded-2xl bg-white dark:bg-surface-950 border border-surface-200 dark:border-surface-800 shadow-sm"
	>
		<div class="space-y-2.5 sm:space-y-4">
			<div class="flex items-start gap-2.5 sm:gap-4">
				<div
					class="mt-1 flex-shrink-0 w-10 h-10 rounded-full bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 flex items-center justify-center text-primary-600 dark:text-primary-400 shadow-sm"
				>
					<UserRound size={20} />
				</div>
				<div class="min-w-0 flex-1">
					<div class="flex flex-wrap items-center gap-x-2 gap-y-0.5 mb-0.5">
						<span
							class="text-3xs uppercase tracking-wider font-bold text-surface-600 dark:text-surface-400"
							>DPC Supervisão</span
						>
						{#if gise.supervisor_id}
							{@const pr = presencaDe(presencasGise, gise.supervisor_id)}
							<MarcadorPresenca entrada={pr.entrada} saida={pr.saida} />
						{/if}
					</div>
					{#if editandoPapel === 'supervisor'}
						<div class="flex flex-col sm:flex-row sm:items-center gap-2 mt-1 w-full">
							<div class="flex-1 min-w-0 sm:max-w-md">
								<SearchableSelect
									id="supId"
									bind:value={supervisorId}
									loadOptions={buscarDpcs}
									ariaLabel="Selecionar DPC de supervisão"
									selectedOption={selectedFromPoliciais(supervisorId)}
									placeholder="Pesquisar DPC..."
									minSearchChars={2}
									showTrigger={false}
									class="w-full"
								/>
							</div>
							{@render botoesSalvarCancelar('supervisor')}
						</div>
					{:else}
						<div class="flex min-w-0 items-center gap-3">
							<p
								class="min-w-0 shrink font-bold text-lg leading-tight text-surface-900 dark:text-white truncate"
							>
								{gise.supervisor_nome ?? 'Não definido'}
							</p>

							{@render botoesEdicao('supervisor', !!gise.supervisor_id, false)}
						</div>
					{/if}
				</div>
			</div>

			<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 sm:gap-3 pt-1.5 sm:pt-2">
				<SupervisaoPapelAssessor
					{gise}
					bind:assessorId
					bind:assessorEmailNotificacao
					{editandoPapel}
					{removendoPapel}
					{policiais}
					{presencasGise}
					{isAdminGeral}
					{podeEditar}
					{modoEdicaoGeral}
					{pendingCrud}
					{buscarOips}
					{selectedFromPoliciais}
					onIniciarEdicao={iniciarEdicao}
					onSolicitarRemocao={solicitarRemocao}
					onCancelarEdicao={cancelarEdicao}
				/>

				<!-- NUIP OIP 1 e 2 — mesmo card, parametrizado pelo papel -->
				<SupervisaoPapelSeint
					papel="seint1"
					idPersistido={gise.seint1_id}
					bind:value={seint1Id}
					{editandoPapel}
					{removendoPapel}
					{policiais}
					{presencasGise}
					{seintRelatorioSet}
					{isAdminGeral}
					{podeEditar}
					{modoEdicaoGeral}
					{pendingCrud}
					{buscarOips}
					{selectedFromPoliciais}
					onIniciarEdicao={iniciarEdicao}
					onSolicitarRemocao={solicitarRemocao}
					onCancelarEdicao={cancelarEdicao}
				/>
				<SupervisaoPapelSeint
					papel="seint2"
					idPersistido={gise.seint2_id}
					bind:value={seint2Id}
					{editandoPapel}
					{removendoPapel}
					{policiais}
					{presencasGise}
					{seintRelatorioSet}
					{isAdminGeral}
					{podeEditar}
					{modoEdicaoGeral}
					{pendingCrud}
					{buscarOips}
					{selectedFromPoliciais}
					onIniciarEdicao={iniciarEdicao}
					onSolicitarRemocao={solicitarRemocao}
					onCancelarEdicao={cancelarEdicao}
				/>
			</div>
		</div>
	</div>

	<input type="hidden" name="supervisor_id" value={supervisorId ?? ''} />
	<input type="hidden" name="assessor_id" value={assessorId ?? ''} />
	<input type="hidden" name="seint1_id" value={seint1Id ?? ''} />
	<input type="hidden" name="seint2_id" value={seint2Id ?? ''} />
	{#if editandoPapel !== 'assessor'}
		<input type="hidden" name="assessor_email_notificacao" value={assessorEmailNotificacao ?? ''} />
		{#if assessorId != null}
			<input type="hidden" name="confirmar_email_assessor" value="1" />
		{/if}
	{/if}
</form>

<ModalShell
	bind:open={confirmarRemocaoOpen}
	title="Remover designação?"
	familia="gise"
	largura="sm"
	pending={pendingCrud}
	cancelLabel="Cancelar"
	onOpenChange={(isOpen) => {
		if (!isOpen) papelParaRemover = null;
	}}
>
	{#snippet description()}
		Deseja realmente remover esta designação?
	{/snippet}

	{#snippet footer()}
		<button
			type="button"
			class="btn preset-filled-error-500"
			onclick={confirmarRemocao}
			disabled={pendingCrud}
		>
			Remover
		</button>
	{/snippet}
</ModalShell>
