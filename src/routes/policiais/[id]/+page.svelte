<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { enhance } from '$app/forms';
	import { toaster } from '$lib/toast';
	import { formatarTelefone, formatarCPF } from '$lib/utils';
	import Spinner from '$lib/components/Spinner.svelte';
	import { policialUpdateSchema } from '$lib/schemas/policial';
	import { superForm } from 'sveltekit-superforms';
	import { zod4Client } from 'sveltekit-superforms/adapters';

	let { data } = $props();

	const isAdmin = $derived(data.isAdmin);
	const isAdminOrSeccional = $derived(data.isAdminOrSeccional);
	const isAdminUnidade = $derived(data.isAdminUnidade);
	const seccionaisParaPapel = $derived(data.unidades.filter((u: any) => u.tipo === 'seccional'));
	const unidadesParaAdmin = $derived(data.unidades.filter((u: any) => u.tipo !== 'seccional'));

	// svelte-ignore state_referenced_locally
	const formObj = superForm(data.form, {
		validators: zod4Client(policialUpdateSchema),
		invalidateAll: false,
		onUpdated: async ({ form }) => {
			if (form.valid && form.message) {
				try {
					const msg = JSON.parse(form.message);
					if (msg.type === 'success') {
						toaster.create({ title: 'Policial atualizado com sucesso!', type: 'success' });
						goto('/policiais');
					} else {
						toaster.create({ title: msg.error || 'Erro ao atualizar', type: 'error' });
					}
				} catch (e) {}
			} else if (!form.valid && form.message) {
				try {
					const msg = JSON.parse(form.message);
					if (msg.error) toaster.create({ title: msg.error, type: 'error' });
				} catch (e) {}
			}
		}
	});

	const formStore = formObj.form;
	const formErrors = formObj.errors;
	const formConstraints = formObj.constraints;
	const formEnhance = formObj.enhance;
	const formSubmitting = formObj.submitting;
	const formDelayed = formObj.delayed;

	// svelte-ignore state_referenced_locally
	let papel = $state<string | null>(data?.policial?.papel ?? null);
	// svelte-ignore state_referenced_locally
	let papelUnidadeId = $state<number | null>(data?.policial?.papel_unidade_id ?? null);
	let salvandoPapel = $state(false);

	function handleSalvarPapel({ formData }: { formData: FormData }) {
		salvandoPapel = true;
		return async ({ result }: { result: any }) => {
			salvandoPapel = false;
			const d = result.data as Record<string, unknown> | undefined;
			if (result.type === 'success') {
				toaster.create({ title: 'Papel atualizado com sucesso!', type: 'success' });
				await invalidateAll();
			} else if (result.type === 'failure' && d?.error) {
				toaster.create({ title: String(d.error), type: 'error' });
			}
		};
	}

	const classesDisponiveis = $derived(
		$formStore.cargo === 'DPC'
			? ['1', '2', '3', 'Especial']
			: [
					'D - I',
					'D - II',
					'C - I',
					'C - II',
					'C - III',
					'C - IV',
					'C - V',
					'C - VI',
					'C - VII',
					'B - I',
					'B - II',
					'B - III',
					'B - IV',
					'B - V',
					'B - VI',
					'B - VII',
					'A - I',
					'A - II',
					'A - III',
					'A - IV'
				]
	);
</script>

<div class="flex items-center justify-between mb-6">
	<h1 class="h1 text-xl font-bold">Editar Policial</h1>
	<a href="/policiais" class="btn preset-outlined-primary-500">Voltar</a>
</div>

<div
	class="p-3 sm:p-4 rounded-xl bg-white/80 dark:bg-surface-900/60 backdrop-blur-md border border-surface-200 dark:border-white/5 shadow-xl shadow-black/5 dark:shadow-black/20"
>
	<form method="POST" action="?/salvar" use:formEnhance class="space-y-2">
		<!-- Linha 1 -->
		<div class="grid grid-cols-1 sm:grid-cols-12 gap-2">
			<label class="label sm:col-span-4 relative mb-3">
				<span class="label-text text-[0.7rem] font-bold uppercase opacity-70 ml-1"
					>Nome completo (Conforme Certificado Digital)</span
				>
				<input class="input py-1 px-3 text-sm {$formErrors.nome ? 'input-error' : ''}" type="text" name="nome" bind:value={$formStore.nome} {...$formConstraints.nome} aria-invalid={$formErrors.nome ? 'true' : undefined} />
				{#if $formErrors.nome}<div class="text-error-500 text-[0.65rem] absolute -bottom-4">{$formErrors.nome[0]}</div>{/if}
			</label>
			<label class="label sm:col-span-2 relative mb-3">
				<span class="label-text text-[0.7rem] font-bold uppercase opacity-70 ml-1">Matrícula</span>
				<input
					class="input py-1 px-3 text-sm {$formErrors.matricula ? 'input-error' : ''}"
					type="text"
					name="matricula"
					bind:value={$formStore.matricula}
					{...$formConstraints.matricula}
					aria-invalid={$formErrors.matricula ? 'true' : undefined}
				/>
				{#if $formErrors.matricula}<div class="text-error-500 text-[0.65rem] absolute -bottom-4">{$formErrors.matricula[0]}</div>{/if}
			</label>
			<label class="label sm:col-span-3 relative mb-3">
				<span class="label-text text-[0.7rem] font-bold uppercase opacity-70 ml-1">Cargo</span>
				<select class="select py-1 px-3 text-sm {$formErrors.cargo ? 'input-error' : ''}" name="cargo" bind:value={$formStore.cargo} {...$formConstraints.cargo} aria-invalid={$formErrors.cargo ? 'true' : undefined}>
					<option value="DPC">DPC - Delegado</option>
					<option value="OIP">OIP - Investigador</option>
				</select>
				{#if $formErrors.cargo}<div class="text-error-500 text-[0.65rem] absolute -bottom-4">{$formErrors.cargo[0]}</div>{/if}
			</label>
			<label class="label sm:col-span-3 relative mb-3">
				<span class="label-text text-[0.7rem] font-bold uppercase opacity-70 ml-1">Telefone</span>
				<input
					class="input py-1 px-3 text-sm {$formErrors.telefone ? 'input-error' : ''}"
					type="text"
					name="telefone"
					value={$formStore.telefone}
					oninput={(e) => ($formStore.telefone = formatarTelefone(e.currentTarget.value))}
					placeholder="(00) 0.0000-0000"
					aria-invalid={$formErrors.telefone ? 'true' : undefined}
				/>
				{#if $formErrors.telefone}<div class="text-error-500 text-[0.65rem] absolute -bottom-4">{$formErrors.telefone[0]}</div>{/if}
			</label>
			<label class="label sm:col-span-3 relative mb-3">
				<span class="label-text text-[0.7rem] font-bold uppercase opacity-70 ml-1"
					>CPF (Obrigatório para Token)</span
				>
				<input
					class="input py-1 px-3 text-sm {$formErrors.cpf ? 'input-error' : ''}"
					type="text"
					name="cpf"
					value={$formStore.cpf}
					oninput={(e) => ($formStore.cpf = formatarCPF(e.currentTarget.value))}
					placeholder="000.000.000-00"
					maxlength="14"
					aria-invalid={$formErrors.cpf ? 'true' : undefined}
				/>
				{#if $formErrors.cpf}<div class="text-error-500 text-[0.65rem] absolute -bottom-4">{$formErrors.cpf[0]}</div>{/if}
			</label>
			<label class="label sm:col-span-9 relative mb-3">
				<span class="label-text text-[0.7rem] font-bold uppercase opacity-70 ml-1"
					>E-mail (para autenticação de dois fatores)</span
				>
				<input
					class="input py-1 px-3 text-sm {$formErrors.email ? 'input-error' : ''}"
					type="email"
					name="email"
					bind:value={$formStore.email}
					{...$formConstraints.email}
					aria-invalid={$formErrors.email ? 'true' : undefined}
					placeholder="exemplo@gmail.com"
				/>
				{#if $formErrors.email}<div class="text-error-500 text-[0.65rem] absolute -bottom-4">{$formErrors.email[0]}</div>{/if}
			</label>
		</div>

		<!-- Linha 2 -->
		<div class="grid grid-cols-1 sm:grid-cols-12 gap-2">
			<label class="label sm:col-span-1 relative mb-3">
				<span class="label-text text-[0.7rem] font-bold uppercase opacity-70 ml-1">Classe</span>
				<select class="select py-1 px-3 text-sm {$formErrors.classe ? 'input-error' : ''}" name="classe" bind:value={$formStore.classe} {...$formConstraints.classe} aria-invalid={$formErrors.classe ? 'true' : undefined}>
					<option value="" disabled>-</option>
					{#each classesDisponiveis as c}
						<option value={c}>{c}</option>
					{/each}
					{#if $formStore.classe && !classesDisponiveis.includes($formStore.classe)}
						<option value={$formStore.classe}>{$formStore.classe} (Atual)</option>
					{/if}
				</select>
				{#if $formErrors.classe}<div class="text-error-500 text-[0.65rem] absolute -bottom-4">{$formErrors.classe[0]}</div>{/if}
			</label>
			<label class="label sm:col-span-4 relative mb-3">
				<span class="label-text text-[0.7rem] font-bold uppercase opacity-70 ml-1"
					>Regime de Trabalho</span
				>
				<select class="select py-1 px-3 text-sm {$formErrors.regime ? 'input-error' : ''}" name="regime" bind:value={$formStore.regime} {...$formConstraints.regime} aria-invalid={$formErrors.regime ? 'true' : undefined}>
					<option value="ambos">Plantão e Expediente</option>
					<option value="plantao">Somente Plantão</option>
					<option value="expediente">Somente Expediente</option>
				</select>
				{#if $formErrors.regime}<div class="text-error-500 text-[0.65rem] absolute -bottom-4">{$formErrors.regime[0]}</div>{/if}
			</label>
			<label class="label sm:col-span-7 relative mb-3">
				<span class="label-text text-[0.7rem] font-bold uppercase opacity-70 ml-1">Lotação</span>
				{#if isAdmin}
					<select class="select py-1 px-3 text-sm {$formErrors.lotacao ? 'input-error' : ''}" name="lotacao" bind:value={$formStore.lotacao} {...$formConstraints.lotacao} aria-invalid={$formErrors.lotacao ? 'true' : undefined}>
						<option value="">— Sem lotação —</option>
						{#each data.lotacoes as u (u)}
							<option value={u}>{u}</option>
						{/each}
					</select>
				{:else}
					<input
						class="input py-1 px-3 text-sm bg-surface-200 dark:bg-surface-800 cursor-not-allowed opacity-75 {$formErrors.lotacao ? 'input-error' : ''}"
						type="text"
						name="lotacao"
						value={$formStore.lotacao}
						readonly
						{...$formConstraints.lotacao}
					/>
				{/if}
				{#if $formErrors.lotacao}<div class="text-error-500 text-[0.65rem] absolute -bottom-4">{$formErrors.lotacao[0]}</div>{/if}
			</label>
		</div>

		<div class="flex gap-2 pt-1 border-t border-surface-200 dark:border-white/5 mt-2">
			<button
				type="submit"
				class="btn btn-sm sm:btn-md preset-filled-primary-500 flex items-center gap-2"
				disabled={$formSubmitting}
			>
				{#if $formDelayed}<Spinner size="sm" />{/if}
				{$formSubmitting ? 'Guardando...' : 'Salvar'}
			</button>
			<a href="/policiais" class="btn btn-sm preset-outlined-primary-500">Cancelar</a>
		</div>
	</form>
</div>

{#if isAdminOrSeccional || isAdminUnidade}
	<div
		class="p-3 sm:p-4 rounded-xl bg-white/80 dark:bg-surface-900/60 backdrop-blur-md border border-surface-200 dark:border-white/5 shadow-xl shadow-black/5 dark:shadow-black/20 mt-4"
	>
		<h2 class="text-base font-bold mb-3 text-surface-700 dark:text-surface-300">
			Papel Administrativo
		</h2>
		<form method="POST" action="?/salvarPapel" use:enhance={handleSalvarPapel} class="space-y-3">
			<div class="grid grid-cols-1 sm:grid-cols-12 gap-2">
				<label class="label sm:col-span-5">
					<span class="label-text text-[0.7rem] font-bold uppercase opacity-70 ml-1">Papel</span>
					<select class="select py-1 px-3 text-sm" name="papel" bind:value={papel}>
						<option value={null}>Servidor (sem papel)</option>
						{#if isAdminOrSeccional}
							<option value="admin_seccional">Admin Seccional</option>
						{/if}
						<option value="admin_unidade">Admin Unidade</option>
					</select>
				</label>
				{#if papel && !(isAdminUnidade && papel === 'admin_unidade')}
					<label class="label sm:col-span-7">
						<span class="label-text text-[0.7rem] font-bold uppercase opacity-70 ml-1">
							{papel === 'admin_seccional'
								? 'Seccional de responsabilidade'
								: 'Unidade de responsabilidade'}
						</span>
						<select
							class="select py-1 px-3 text-sm"
							name="papel_unidade_id"
							bind:value={papelUnidadeId}
						>
							<option value={null}>Selecionar...</option>
							{#each papel === 'admin_seccional' ? seccionaisParaPapel : unidadesParaAdmin as u}
								<option value={u.id}>{u.nome}</option>
							{/each}
						</select>
					</label>
				{:else if papel === 'admin_unidade' && isAdminUnidade}
					<p class="text-xs text-surface-500 sm:col-span-7 flex items-end pb-2 ml-1">
						Será nomeado para a sua própria unidade.
					</p>
				{/if}
			</div>
			<div class="flex gap-2 pt-1 border-t border-surface-200 dark:border-white/5 mt-2">
				<button
					type="submit"
					class="btn btn-sm preset-filled-primary-500 flex items-center gap-2"
					disabled={salvandoPapel}
				>
					{#if salvandoPapel}<Spinner size="sm" />{/if}
					{salvandoPapel ? 'Salvando...' : 'Salvar papel'}
				</button>
			</div>
		</form>
	</div>
{/if}
