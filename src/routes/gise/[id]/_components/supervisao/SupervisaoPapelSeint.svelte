<script lang="ts">
	/**
	 * Slot NUIP OIP (SEINT) do quadro de supervisão — um dos dois papéis
	 * idênticos parametrizados por `papel`. Inclui marcador de rodagem e
	 * edição inline (Admin Geral).
	 */
	import SearchableSelect from '$lib/components/SearchableSelect.svelte';
	import MarcadorPresenca from '../MarcadorPresenca.svelte';
	import PenLine from '@lucide/svelte/icons/pen-line';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Users from '@lucide/svelte/icons/users';
	import Spinner from '$lib/components/Spinner.svelte';
	import { marcadorRodagem, presencaDe } from './rodagem';
	import type {
		LoadOptionsFn,
		PapelSupervisao,
		PolicialOpcao,
		PresencaGiseLinha,
		SelectedOption
	} from './types';

	interface Props {
		papel: 'seint1' | 'seint2';
		/** Valor persistido (nome/marcador). */
		idPersistido: number | null;
		value: number | null;
		editandoPapel: PapelSupervisao | null;
		removendoPapel: PapelSupervisao | null;
		policiais: PolicialOpcao[];
		presencasGise: PresencaGiseLinha[] | null;
		seintRelatorioSet: Set<number>;
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
		papel,
		idPersistido,
		value = $bindable(),
		editandoPapel,
		removendoPapel,
		policiais,
		presencasGise,
		seintRelatorioSet,
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
	class="flex items-center justify-between gap-2 p-2.5 px-3 rounded-xl bg-white dark:bg-surface-900 border border-secondary-500/20 dark:border-secondary-500/35 shadow-sm hover:shadow transition-all duration-200"
>
	<div class="flex items-center gap-2.5 min-w-0 flex-1">
		<div class="text-secondary-600/70 dark:text-secondary-400/70 shrink-0">
			<Users size={14} />
		</div>
		<div class="overflow-hidden min-w-0 flex-1">
			<!-- Rótulo + indicador de presença na MESMA linha: fica fora do espaço do
			     nome do escalado (que abaixo pode truncar). -->
			<div class="flex flex-wrap items-center gap-x-2 gap-y-0.5">
				<span class="text-3xs uppercase font-bold text-secondary-500/80 dark:text-secondary-400/80"
					>NUIP OIP</span
				>
				{#if idPersistido}
					{@const pr = presencaDe(presencasGise, idPersistido)}
					<MarcadorPresenca
						entrada={pr.entrada}
						saida={pr.saida}
						faltaRelatorio={marcadorRodagem(
							'seint',
							idPersistido,
							presencasGise,
							seintRelatorioSet
						) === 'falta_relatorio'}
					/>
				{/if}
			</div>
			{#if editandoPapel === papel}
				<div class="flex flex-col sm:flex-row sm:items-center gap-2 mt-1 w-full">
					<div class="flex-1 min-w-0">
						<SearchableSelect
							id="{papel}Id"
							bind:value
							loadOptions={buscarOips}
							ariaLabel="Selecionar NUIP OIP"
							selectedOption={selectedFromPoliciais(value)}
							placeholder="Pesquisar NUIP OIP..."
							minSearchChars={2}
							showTrigger={false}
							class="w-full"
						/>
					</div>
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
							onclick={onCancelarEdicao}
							disabled={pendingCrud}
						>
							Fechar
						</button>
					</div>
				</div>
			{:else}
				<div class="flex items-center gap-2">
					<p class="text-sm font-semibold text-surface-700 dark:text-surface-200 truncate">
						{idPersistido
							? (policiais.find((p) => p.id === idPersistido)?.nome ?? 'Carregando...')
							: 'Não definido'}
					</p>
					{#if isAdminGeral && podeEditar && modoEdicaoGeral}
						<div class="flex items-center gap-1 shrink-0">
							<button
								type="button"
								class="btn btn-xs preset-filled-surface-500 rounded p-1"
								title="Editar"
								aria-label="Editar"
								onclick={() => onIniciarEdicao(papel)}
							>
								<PenLine size={12} />
							</button>
							{#if idPersistido}
								<button
									type="button"
									class="btn btn-xs preset-outlined-error-500 rounded p-1"
									title="Remover"
									aria-label="Remover"
									onclick={() => onSolicitarRemocao(papel)}
									disabled={pendingCrud}
								>
									{#if pendingCrud && removendoPapel === papel}
										<Spinner size="xs" />
									{:else}
										<Trash2 size={12} />
									{/if}
								</button>
							{/if}
						</div>
					{/if}
				</div>
			{/if}
		</div>
	</div>
</div>
