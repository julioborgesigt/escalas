<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import SearchableSelect from '$lib/components/SearchableSelect.svelte';
	import { ShieldCheck, UserRound, Users, FileDown, CheckCircle2, Clock, PenLine } from 'lucide-svelte';

	interface Gise {
		id: number;
		supervisor_id: number | null;
		supervisor_nome: string | null;
		assessor_id: number | null;
		seint1_id: number | null;
		seint2_id: number | null;
	}

	interface Policial {
		id: number;
		nome: string;
		matricula: string;
		cargo: string;
	}

	interface DocumentoAssinadoInfo {
		existe: boolean;
		assinante_nome: string;
	}

	interface Props {
		gise: Gise;
		policiais: Policial[];
		dpcs: Policial[];
		oips: Policial[];
		isAdminGeral: boolean;
		isSeccional: boolean;
		podeEditar: boolean;
		modoEdicaoGeral: boolean;
		editando: boolean;
		documentoAssinadoInfo: DocumentoAssinadoInfo | null;
		pendingCrud: boolean;
		supervisorId: number | null;
		assessorId: number | null;
		seint1Id: number | null;
		seint2Id: number | null;
		onEditar: () => void;
		onCancelar: () => void;
		onSubmit: SubmitFunction;
	}

	let {
		gise,
		policiais,
		dpcs,
		oips,
		isAdminGeral,
		isSeccional,
		podeEditar,
		modoEdicaoGeral,
		editando,
		documentoAssinadoInfo,
		pendingCrud,
		supervisorId = $bindable(),
		assessorId = $bindable(),
		seint1Id = $bindable(),
		seint2Id = $bindable(),
		onEditar,
		onCancelar,
		onSubmit
	}: Props = $props();
</script>

<div
	class="relative overflow-visible rounded-2xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 shadow-sm transition-all duration-300 hover:shadow-md"
>
	<div
		class="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-primary-500 via-secondary-500 to-tertiary-500 opacity-70"
	></div>

	<div class="p-6">
		<div class="flex flex-wrap items-center justify-between gap-4 mb-5">
			<div class="flex items-center gap-3">
				<div class="p-2 rounded-lg bg-primary-500/10 text-primary-600 dark:text-primary-400">
					<ShieldCheck size={24} />
				</div>
				<h2 class="text-xl font-bold text-surface-900 dark:text-surface-50 tracking-tight">
					Supervisão e apoio
				</h2>
			</div>

			{#if isAdminGeral && podeEditar && modoEdicaoGeral && !editando}
				<button
					type="button"
					class="flex items-center gap-2 text-sm px-4 py-2 rounded-xl font-bold transition-all duration-200 {!gise.supervisor_id
						? 'bg-warning-500 text-white hover:bg-warning-600 shadow-lg shadow-warning-500/20 animate-pulse'
						: 'bg-surface-100 dark:bg-surface-800 text-surface-700 dark:text-surface-300 hover:bg-surface-200 dark:hover:bg-surface-700 border border-surface-200 dark:border-surface-700'}"
					onclick={onEditar}
				>
					<PenLine size={16} />
					{!gise.supervisor_id ? 'Definir Supervisão' : 'Editar Supervisão'}
				</button>
			{/if}
		</div>

		{#if editando}
			<div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
				<div>
					<label
						for="supId"
						class="text-sm font-bold text-surface-600 dark:text-surface-400 block mb-2 px-1"
						>Supervisão e apoio (DPC)</label
					>
					<SearchableSelect
						id="supId"
						bind:value={supervisorId}
						options={[
							{ value: null, label: 'Não definido' },
							...dpcs.map((p) => ({ value: p.id, label: `${p.nome} (${p.matricula})` }))
						]}
						placeholder="Pesquisar Supervisão..."
						class="w-full"
					/>
				</div>
				<div>
					<label
						for="assessorId"
						class="text-sm font-bold text-surface-600 dark:text-surface-400 block mb-2 px-1"
					>
						Assessor (OIP)
					</label>
					<SearchableSelect
						id="assessorId"
						bind:value={assessorId}
						options={[
							{ value: null, label: 'Não definido' },
							...oips.map((p) => ({ value: p.id, label: `${p.nome} (${p.matricula})` }))
						]}
						placeholder="Pesquisar Assessor..."
						class="w-full"
					/>
				</div>
				<div>
					<label
						for="seint1Id"
						class="text-sm font-bold text-surface-600 dark:text-surface-400 block mb-2 px-1"
					>
						Inteligência 1 (SEINT - OIP)
					</label>
					<SearchableSelect
						id="seint1Id"
						bind:value={seint1Id}
						options={[
							{ value: null, label: 'Não definido' },
							...oips.map((p) => ({ value: p.id, label: `${p.nome} (${p.matricula})` }))
						]}
						placeholder="Pesquisar SEINT 1..."
						class="w-full"
					/>
				</div>
				<div>
					<label
						for="seint2Id"
						class="text-sm font-bold text-surface-600 dark:text-surface-400 block mb-2 px-1"
					>
						Inteligência 2 (SEINT - OIP)
					</label>
					<SearchableSelect
						id="seint2Id"
						bind:value={seint2Id}
						options={[
							{ value: null, label: 'Não definido' },
							...oips.map((p) => ({ value: p.id, label: `${p.nome} (${p.matricula})` }))
						]}
						placeholder="Pesquisar SEINT 2..."
						class="w-full"
					/>
				</div>
			</div>
			<form
				method="POST"
				action="?/salvarSupervisores"
				use:enhance={onSubmit}
				class="flex gap-2"
			>
				<input type="hidden" name="supervisor_id" value={supervisorId ?? ''} />
				<input type="hidden" name="assessor_id" value={assessorId ?? ''} />
				<input type="hidden" name="seint1_id" value={seint1Id ?? ''} />
				<input type="hidden" name="seint2_id" value={seint2Id ?? ''} />
				<button
					type="submit"
					class="btn preset-filled-primary-500 text-sm px-3 py-1.5 rounded-lg"
					disabled={pendingCrud}
				>
					{pendingCrud ? 'Salvando...' : 'Salvar'}
				</button>
				<button
					type="button"
					class="btn preset-outlined-surface text-sm px-3 py-1.5 rounded-lg"
					onclick={onCancelar}
				>
					Cancelar
				</button>
			</form>
		{:else}
			<div
				class="p-5 rounded-2xl bg-surface-50/50 dark:bg-surface-800/40 border border-surface-200/60 dark:border-surface-700/60 backdrop-blur-sm"
			>
				<div class="flex flex-col md:flex-row md:items-center justify-between gap-6">
					<div class="space-y-4 flex-1">
						<div class="flex items-start gap-4">
							<div
								class="mt-1 flex-shrink-0 w-10 h-10 rounded-full bg-white dark:bg-surface-700 border border-surface-200 dark:border-surface-600 flex items-center justify-center text-primary-600 dark:text-primary-400 shadow-sm"
							>
								<UserRound size={20} />
							</div>
							<div>
								<span
									class="block text-[0.65rem] uppercase tracking-wider font-bold text-surface-500 dark:text-surface-400 mb-0.5"
									>DPC Supervisão</span
								>
								<p class="font-bold text-lg text-surface-900 dark:text-white leading-tight">
									{gise.supervisor_nome ?? 'Não definido'}
								</p>
							</div>
						</div>

						<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 pt-2">
							{#if gise.assessor_id}
								<div
									class="flex items-center gap-2.5 p-2 px-3 rounded-lg bg-white/60 dark:bg-surface-900/40 border border-surface-100 dark:border-surface-700/50"
								>
									<div class="text-surface-400 dark:text-surface-500">
										<Users size={14} />
									</div>
									<div class="overflow-hidden">
										<span
											class="block text-[0.6rem] uppercase font-bold text-surface-400 dark:text-surface-500"
											>Assessor</span
										>
										<p
											class="text-sm font-semibold text-surface-700 dark:text-surface-200 truncate"
										>
											{policiais.find((p) => p.id === gise.assessor_id)?.nome ?? 'Carregando...'}
										</p>
									</div>
								</div>
							{/if}

							{#if gise.seint1_id}
								<div
									class="flex items-center gap-2.5 p-2 px-3 rounded-lg bg-indigo-500/5 dark:bg-indigo-500/10 border border-indigo-500/10 dark:border-indigo-500/20"
								>
									<div class="text-indigo-600/70 dark:text-indigo-400/70">
										<Users size={14} />
									</div>
									<div class="overflow-hidden">
										<span
											class="block text-[0.6rem] uppercase font-bold text-indigo-500/80 dark:text-indigo-400/80"
											>SEINT OIP</span
										>
										<p
											class="text-sm font-semibold text-surface-700 dark:text-surface-200 truncate"
										>
											{policiais.find((p) => p.id === gise.seint1_id)?.nome ?? 'Carregando...'}
										</p>
									</div>
								</div>
							{/if}

							{#if gise.seint2_id}
								<div
									class="flex items-center gap-2.5 p-2 px-3 rounded-lg bg-indigo-500/5 dark:bg-indigo-500/10 border border-indigo-500/10 dark:border-indigo-500/20"
								>
									<div class="text-indigo-600/70 dark:text-indigo-400/70">
										<Users size={14} />
									</div>
									<div class="overflow-hidden">
										<span
											class="block text-[0.6rem] uppercase font-bold text-indigo-500/80 dark:text-indigo-400/80"
											>SEINT OIP</span
										>
										<p
											class="text-sm font-semibold text-surface-700 dark:text-surface-200 truncate"
										>
											{policiais.find((p) => p.id === gise.seint2_id)?.nome ?? 'Carregando...'}
										</p>
									</div>
								</div>
							{/if}
						</div>
					</div>

					<div class="flex flex-col items-end gap-3 min-w-[140px]">
						{#if documentoAssinadoInfo?.existe}
							<div class="flex flex-col items-end">
								<span
									class="flex items-center gap-1.5 px-3 py-1 rounded-full bg-success-500 text-white font-bold text-xs uppercase tracking-wider shadow-lg shadow-success-500/20"
								>
									<CheckCircle2 size={12} />
									Assinada
								</span>
							</div>
						{:else}
							<div class="flex flex-col items-end">
								<span
									class="flex items-center gap-1.5 px-3 py-1 rounded-full bg-warning-500 text-white font-bold text-xs uppercase tracking-wider shadow-lg shadow-warning-500/20"
								>
									<Clock size={12} />
									Pendente
								</span>
							</div>
						{/if}
					</div>
				</div>

				{#if documentoAssinadoInfo?.existe}
					<div
						class="mt-6 pt-4 border-t border-surface-200/60 dark:border-surface-700/60 flex flex-wrap items-center justify-between gap-4"
					>
						<div class="flex items-center gap-2 text-xs text-surface-500 dark:text-surface-400">
							<div
								class="w-8 h-8 rounded-lg bg-surface-100 dark:bg-surface-700 flex items-center justify-center"
							>
								<ShieldCheck size={16} />
							</div>
							<div>
								<p>Assinado digitalmente por:</p>
								<p class="font-bold text-surface-900 dark:text-surface-100">
									{documentoAssinadoInfo.assinante_nome}
								</p>
							</div>
						</div>

						<a
							href={`/api/gise/${gise.id}/documento-assinado`}
							target="_blank"
							class="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary-600 hover:bg-primary-700 text-white text-sm font-bold transition-all shadow-lg shadow-primary-500/20 active:scale-95"
						>
							<FileDown size={18} />
							Baixar PDF Assinado
						</a>
					</div>
				{/if}
			</div>
			{#if isAdminGeral || isSeccional}
				<a
					href={`/api/gise/${gise.id}/download?format=pdf`}
					target="_blank"
					class="text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 hover:underline text-sm flex items-center gap-1 mt-1"
				>
					<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"
						><path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
						/></svg
					>
					PDF da escala sem assinatura
				</a>
			{/if}
		{/if}
	</div>
</div>
