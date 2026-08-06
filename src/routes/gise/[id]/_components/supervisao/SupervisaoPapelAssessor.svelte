<script lang="ts">
	/**
	 * Slot Assessor do quadro de supervisão — designação + e-mail de avisos GISE
	 * (com checkbox de confirmação) e marcador de rodagem.
	 */
	import SearchableSelect from '$lib/components/SearchableSelect.svelte';
	import MarcadorPresenca from '../MarcadorPresenca.svelte';
	import { PenLine, Trash2, Users } from '@lucide/svelte';
	import Spinner from '$lib/components/Spinner.svelte';
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
		assessorId: number | null;
		assessorEmailNotificacao: string;
		editandoPapel: PapelSupervisao | null;
		removendoPapel: PapelSupervisao | null;
		policiais: PolicialOpcao[];
		presencasGise: PresencaGiseLinha[] | null;
		isAdminGeral: boolean;
		podeEditar: boolean;
		modoEdicaoGeral: boolean;
		pendingCrud: boolean;
		buscarOips: LoadOptionsFn;
		selectedFromPoliciais: (id: number | null) => SelectedOption;
		onIniciarEdicao: (papel: PapelSupervisao) => void;
		onSolicitarRemocao: (papel: PapelSupervisao) => void;
		onCancelarEdicao: () => void;
	}

	let {
		gise,
		assessorId = $bindable(),
		assessorEmailNotificacao = $bindable(''),
		editandoPapel,
		removendoPapel,
		policiais,
		presencasGise,
		isAdminGeral,
		podeEditar,
		modoEdicaoGeral,
		pendingCrud,
		buscarOips,
		selectedFromPoliciais,
		onIniciarEdicao,
		onSolicitarRemocao,
		onCancelarEdicao
	}: Props = $props();
</script>

<div
	class="flex flex-col gap-2 p-2.5 px-3 rounded-xl bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-800 shadow-sm hover:shadow transition-all duration-200 {editandoPapel ===
	'assessor'
		? 'col-span-full'
		: ''}"
>
	{#if editandoPapel === 'assessor'}
		<div class="flex flex-col gap-1.5 w-full">
			<div class="flex items-center gap-2">
				<div class="text-surface-400 dark:text-surface-500 shrink-0">
					<Users size={14} />
				</div>
				<span class="block text-3xs uppercase font-bold text-surface-400 dark:text-surface-500">
					Assessor
				</span>
			</div>
			<div class="flex flex-wrap lg:flex-nowrap items-end gap-3 w-full">
				<div class="flex-1 min-w-[200px]">
					<span class="block text-3xs font-semibold text-surface-600 dark:text-surface-400 mb-1">
						Nome do Assessor
					</span>
					<SearchableSelect
						id="assessorId"
						bind:value={assessorId}
						loadOptions={buscarOips}
						ariaLabel="Selecionar assessor"
						selectedOption={selectedFromPoliciais(assessorId)}
						placeholder="Pesquisar Assessor..."
						minSearchChars={2}
						showTrigger={false}
						class="w-full"
					/>
				</div>

				{#if assessorId != null}
					<div class="flex-1 min-w-[200px]">
						<label
							for="assessorEmailNotif"
							class="block text-3xs font-semibold text-surface-600 dark:text-surface-400 mb-1"
						>
							E-mail (avisos GISE)
						</label>
						<input
							id="assessorEmailNotif"
							type="email"
							name="assessor_email_notificacao"
							autocomplete="email"
							bind:value={assessorEmailNotificacao}
							class="w-full px-3 py-1.5 rounded-xl border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-800 text-sm focus:border-primary-400 focus:ring-1 focus:ring-primary-400/30 focus:outline-none transition-colors text-surface-900 dark:text-surface-50 placeholder:text-surface-400 dark:placeholder:text-surface-500 h-[38px]"
							placeholder="nome@provedor.com"
						/>
					</div>

					<div class="flex items-center h-[38px] shrink-0">
						<label class="flex items-center gap-1.5 cursor-pointer">
							<input
								type="checkbox"
								name="confirmar_email_assessor"
								value="1"
								class="rounded border-surface-400 w-3.5 h-3.5"
								required
							/>
							<span
								class="text-2xs text-surface-600 dark:text-surface-400 leading-none select-none"
							>
								Confirmo e-mail.
							</span>
						</label>
					</div>
				{/if}

				<div class="w-full grid grid-cols-2 gap-2 sm:flex sm:w-auto sm:shrink-0 h-[38px]">
					<button
						type="submit"
						class="btn preset-filled-primary-500 text-sm px-3 py-1.5 rounded-lg w-full sm:w-auto transition-all"
						disabled={pendingCrud}
					>
						{#if pendingCrud && editandoPapel === 'assessor'}
							<Spinner size="sm" />
						{:else}
							Adicionar
						{/if}
					</button>
					<button
						type="button"
						class="btn preset-outlined-primary-500 text-sm px-3 py-1.5 rounded-lg w-full sm:w-auto"
						onclick={onCancelarEdicao}
						disabled={pendingCrud}
					>
						Fechar
					</button>
				</div>
			</div>
		</div>
	{:else}
		<div class="flex items-center justify-between gap-2">
			<div class="flex items-center gap-2.5 min-w-0 flex-1">
				<div class="text-surface-400 dark:text-surface-500 shrink-0">
					<Users size={14} />
				</div>
				<div class="overflow-hidden min-w-0 flex-1">
					<div class="flex flex-wrap items-center gap-x-2 gap-y-0.5">
						<span class="text-3xs uppercase font-bold text-surface-400 dark:text-surface-500"
							>Assessor</span
						>
						{#if gise.assessor_id}
							{@const pr = presencaDe(presencasGise, gise.assessor_id)}
							<MarcadorPresenca entrada={pr.entrada} saida={pr.saida} />
						{/if}
					</div>
					<div class="flex items-center gap-2">
						<p class="text-sm font-semibold text-surface-700 dark:text-surface-200 truncate">
							{gise.assessor_id
								? (policiais.find((p) => p.id === gise.assessor_id)?.nome ?? 'Carregando...')
								: 'Não definido'}
						</p>
						{#if isAdminGeral && podeEditar && modoEdicaoGeral}
							<div class="flex items-center gap-1 shrink-0">
								<button
									type="button"
									class="btn btn-xs preset-filled-surface-500 rounded p-1"
									title="Editar"
									aria-label="Editar"
									onclick={() => onIniciarEdicao('assessor')}
								>
									<PenLine size={12} />
								</button>
								{#if gise.assessor_id}
									<button
										type="button"
										class="btn btn-xs preset-outlined-error-500 rounded p-1"
										title="Remover"
										aria-label="Remover"
										onclick={() => onSolicitarRemocao('assessor')}
										disabled={pendingCrud}
									>
										{#if pendingCrud && removendoPapel === 'assessor'}
											<Spinner size="xs" />
										{:else}
											<Trash2 size={12} />
										{/if}
									</button>
								{/if}
							</div>
						{/if}
					</div>
					{#if gise.assessor_email_notificacao}
						<p
							class="text-3xs text-surface-600 dark:text-surface-400 truncate mt-0.5"
							title="E-mail para avisos de seccionais"
						>
							Avisos: {gise.assessor_email_notificacao}
						</p>
					{/if}
				</div>
			</div>
		</div>
	{/if}
</div>
