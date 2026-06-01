<script lang="ts">
	import { goto, invalidate, invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import { enhance } from '$app/forms';
	import { toaster } from '$lib/toast';
	import { formatarTelefone, formatarCPF } from '$lib/utils';
	import { loading } from '$lib/loading.svelte';
	import type { ActionResult } from '@sveltejs/kit';

	const { data } = $props();

	const isAdmin = $derived(data.isAdmin);
	const isAdminOrSeccional = $derived(data.isAdminOrSeccional);
	const isAdminUnidade = $derived(data.isAdminUnidade);
	const seccionaisParaPapel = $derived(data.unidades.filter((u: { tipo: string }) => u.tipo === 'seccional'));
	const unidadesParaAdmin = $derived(data.unidades.filter((u: { tipo: string }) => u.tipo !== 'seccional'));

	let nome = $state('');
	let matricula = $state('');
	let cargo = $state('');
	let cpf = $state('');
	let telefone = $state('');
	let classe = $state('');
	let regime = $state('');
	let lotacao = $state('');
	let email = $state('');
	let papel = $state<string | null>(null);
	let papelUnidadeId = $state<number | null>(null);

	$effect(() => {
		if (data?.policial) {
			nome = data.policial.nome;
			matricula = data.policial.matricula;
			cargo = data.policial.cargo;
			cpf = formatarCPF(data.policial.cpf || '');
			telefone = data.policial.telefone || '';
			classe = (data.policial as Record<string, unknown>).classe as string || '';
			regime = data.policial.regime || 'plantao';
			lotacao = data.policial.lotacao;
			email = data.policial.email || '';
			papel = data.policial.papel;
			papelUnidadeId = data.policial.papel_unidade_id;
		}
	});

	function handleSalvar({ formData }: { formData: FormData }) {
		loading.show('Salvando dados do policial...');
		return async ({ result }: { result: ActionResult }) => {
			loading.hide();
			if (result.type === 'success') {
				toaster.create({ title: 'Policial atualizado com sucesso!', type: 'success' });
				goto('/policiais');
			} else if (result.type === 'failure') {
				const d = result.data as Record<string, unknown> | undefined;
				if (d?.error) toaster.create({ title: String(d.error), type: 'error' });
			}
		};
	}

	function handleSalvarPapel({ formData }: { formData: FormData }) {
		loading.show('Atualizando papel administrativo...');
		return async ({ result }: { result: ActionResult }) => {
			loading.hide();
			if (result.type === 'success') {
				toaster.create({ title: 'Papel atualizado com sucesso!', type: 'success' });
				await invalidateAll();
			} else if (result.type === 'failure') {
				const d = result.data as Record<string, unknown> | undefined;
				if (d?.error) toaster.create({ title: String(d.error), type: 'error' });
			}
		};
	}

	const classesDisponiveis = $derived(
		cargo === 'DPC'
			? ['1ª', '2ª', '3ª', 'ESPECIAL']
			: ['A', 'B', 'C', 'D']
	);
</script>

<div class="flex items-center justify-between mb-6">
	<h1 class="h1 text-2xl font-bold">Editar Policial</h1>
	<a href="/policiais" class="btn preset-outlined-primary-500">Voltar</a>
</div>

<div
	class="p-3 sm:p-4 rounded-xl bg-white/80 dark:bg-surface-900/60 backdrop-blur-md border border-surface-200 dark:border-white/5 shadow-xl shadow-black/5 dark:shadow-black/20"
>
	<form method="POST" action="?/salvar" use:enhance={handleSalvar} class="space-y-2">
		<!-- Linha 1 -->
		<div class="grid grid-cols-1 sm:grid-cols-12 gap-2">
			<label class="label sm:col-span-4">
				<span class="label-text text-[0.7rem] font-bold uppercase opacity-70 ml-1"
					>Nome completo (Conforme Certificado Digital)</span
				>
				<input class="input py-1 px-3 text-sm" type="text" name="nome" bind:value={nome} required />
			</label>
			<label class="label sm:col-span-2">
				<span class="label-text text-[0.7rem] font-bold uppercase opacity-70 ml-1">Matrícula</span>
				<input
					class="input py-1 px-3 text-sm"
					type="text"
					name="matricula"
					bind:value={matricula}
					required
				/>
			</label>
			<label class="label sm:col-span-3">
				<span class="label-text text-[0.7rem] font-bold uppercase opacity-70 ml-1">Cargo</span>
				<select class="select py-1 px-3 text-sm" name="cargo" bind:value={cargo}>
					<option value="DPC">DPC - Delegado</option>
					<option value="OIP">OIP - Investigador</option>
				</select>
			</label>
			<label class="label sm:col-span-3">
				<span class="label-text text-[0.7rem] font-bold uppercase opacity-70 ml-1">Telefone</span>
				<input
					class="input py-1 px-3 text-sm"
					type="text"
					name="telefone"
					value={telefone}
					oninput={(e) => (telefone = formatarTelefone(e.currentTarget.value))}
					placeholder="(00) 0.0000-0000"
				/>
			</label>
			<label class="label sm:col-span-3">
				<span class="label-text text-[0.7rem] font-bold uppercase opacity-70 ml-1"
					>CPF (Obrigatório para Token)</span
				>
				<input
					class="input py-1 px-3 text-sm"
					type="text"
					name="cpf"
					value={cpf}
					oninput={(e) => (cpf = formatarCPF(e.currentTarget.value))}
					placeholder="000.000.000-00"
					maxlength="14"
				/>
			</label>
			<label class="label sm:col-span-9">
				<span class="label-text text-[0.7rem] font-bold uppercase opacity-70 ml-1"
					>E-mail funcional (para 2FA)</span
				>
				<input
					class="input py-1 px-3 text-sm"
					type="email"
					name="email"
					bind:value={email}
					placeholder="exemplo@gmail.com"
				/>
			</label>
		</div>

		<!-- Linha 2 -->
		<div class="grid grid-cols-1 sm:grid-cols-12 gap-2">
			<label class="label sm:col-span-1">
				<span class="label-text text-[0.7rem] font-bold uppercase opacity-70 ml-1">Classe</span>
				<select class="select py-1 px-3 text-sm" name="classe" bind:value={classe} required>
					<option value="" disabled>-</option>
					{#each classesDisponiveis as c}
						<option value={c}>{c}</option>
					{/each}
					{#if classe && !classesDisponiveis.includes(classe)}
						<option value={classe}>{classe} (Atual)</option>
					{/if}
				</select>
			</label>
			<label class="label sm:col-span-4">
				<span class="label-text text-[0.7rem] font-bold uppercase opacity-70 ml-1"
					>Regime de Trabalho</span
				>
				<select class="select py-1 px-3 text-sm" name="regime" bind:value={regime}>
					<option value="plantao">Plantão</option>
					<option value="expediente">Expediente</option>
				</select>
			</label>
			<label class="label sm:col-span-7">
				<span class="label-text text-[0.7rem] font-bold uppercase opacity-70 ml-1">Lotação</span>
				{#if isAdmin}
					<select class="select py-1 px-3 text-sm" name="lotacao" bind:value={lotacao}>
						<option value="">— Sem lotação —</option>
						{#each data.lotacoes as u (u)}
							<option value={u}>{u}</option>
						{/each}
					</select>
				{:else}
					<input
						class="input py-1 px-3 text-sm bg-surface-200 dark:bg-surface-800 cursor-not-allowed opacity-75"
						type="text"
						name="lotacao"
						value={lotacao}
						readonly
					/>
				{/if}
			</label>
		</div>

		<div class="flex gap-2 pt-1 border-t border-surface-200 dark:border-white/5 mt-2">
			<button
				type="submit"
				class="btn btn-sm sm:btn-md preset-filled-primary-500 flex items-center gap-2"
				disabled={loading.active}
			>
				{loading.active ? 'Guardando...' : 'Salvar'}
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
					disabled={loading.active}
				>
					{loading.active ? 'Salvando...' : 'Salvar papel'}
				</button>
			</div>
		</form>
	</div>
{/if}
