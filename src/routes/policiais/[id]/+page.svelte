<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { toaster } from '$lib/toast';
	import type { Policial } from '$lib/types';
	import { formatarTelefone } from '$lib/utils';

	const isAdmin = $derived(page.data.usuario?.tipo === 'admin');

	let policial = $state<Policial | null>(null);
	let nome = $state('');
	let matricula = $state('');
	let cargo = $state<'DPC' | 'OIP'>('OIP');
	let telefone = $state('');
	let classe = $state('');
	let regime = $state<'plantao' | 'expediente' | 'ambos'>('ambos');
	let lotacao = $state('');
	let unidades = $state<string[]>([]);
	let saving = $state(false);
	let loading = $state(true);
	let papel = $state<string | null>(null);
	let papelUnidadeId = $state<number | null>(null);
	let todasUnidadesObj = $state<{id: number, nome: string, tipo: string}[]>([]);
	let salvandoPapel = $state(false);

	const isAdminOrSeccional = $derived(
		page.data.usuario?.tipo === 'admin' || page.data.usuario?.papel === 'admin_seccional'
	);
	const seccionaisParaPapel = $derived(todasUnidadesObj.filter((u: any) => u.tipo === 'seccional'));

	$effect(() => {
		const id = page.params.id;
		fetch(`/api/policiais/${id}`)
			.then(r => r.json())
			.then((data: Policial) => {
				policial = data;
				nome = data.nome;
				matricula = data.matricula;
				cargo = data.cargo;
				telefone = data.telefone || '';
				classe = (data as unknown as { classe?: string }).classe || '';
				regime = (data.regime as 'plantao' | 'expediente' | 'ambos') || 'ambos';
				lotacao = data.lotacao;
				papel = data.papel ?? null;
				papelUnidadeId = data.papel_unidade_id ?? null;
				loading = false;
			});

		if (isAdmin) {
			fetch('/api/lotacoes').then(r => r.json()).then((data: string[]) => {
				unidades = data;
			});
		}
		if (isAdminOrSeccional) {
			fetch('/api/unidades').then(r => r.json()).then((data: any[]) => {
				todasUnidadesObj = data;
			});
		}
	});

	const classesDisponiveis = $derived(
		cargo === 'DPC' 
			? ['1', '2', '3', 'Especial']
			: [
				'D - I', 'D - II',
				'C - I', 'C - II', 'C - III', 'C - IV', 'C - V', 'C - VI', 'C - VII',
				'B - I', 'B - II', 'B - III', 'B - IV', 'B - V', 'B - VI', 'B - VII',
				'A - I', 'A - II', 'A - III', 'A - IV'
			]
	);

	let firstLoad = true;
	$effect(() => {
		// Only reset classe on subsequent cargo changes, not when first loaded
		if (!firstLoad && !loading) {
			classe = '';
		}
		if (!loading) firstLoad = false;
	});

	async function salvar(e: Event) {
		e.preventDefault();
		saving = true;

		const res = await fetch(`/api/policiais/${page.params.id}`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ nome, matricula, cargo, telefone, lotacao, regime, classe })
		});

		if (res.ok) {
			toaster.create({ title: 'Policial atualizado com sucesso!', type: 'success' });
			goto('/policiais');
		} else {
			const data = await res.json();
			toaster.create({ title: data.error || 'Erro ao salvar', type: 'error' });
		}
		saving = false;
	}

	async function salvarPapel(e: Event) {
		e.preventDefault();
		salvandoPapel = true;
		try {
			const res = await fetch('/api/admin/papeis', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					policial_id: Number(page.params.id),
					papel: papel || null,
					papel_unidade_id: papelUnidadeId || null
				})
			});
			const json = await res.json();
			if (!res.ok) throw new Error(json.error);
			toaster.create({ title: 'Papel atualizado com sucesso!', type: 'success' });
		} catch (err: any) {
			toaster.create({ title: err.message || 'Erro ao atualizar papel', type: 'error' });
		} finally {
			salvandoPapel = false;
		}
	}
</script>

<div class="flex items-center justify-between mb-6">
	<h1 class="h1 text-xl font-bold">Editar Policial</h1>
	<a href="/policiais" class="btn preset-outlined-primary-500">Voltar</a>
</div>

{#if loading}
	<p class="text-center py-8">Carregando...</p>
{:else}
	<div class="p-3 sm:p-4 rounded-xl bg-white/80 dark:bg-surface-900/60 backdrop-blur-md border border-surface-200 dark:border-white/5 shadow-xl shadow-black/5 dark:shadow-black/20">
		<form onsubmit={salvar} class="space-y-2">
			<!-- Linha 1 -->
			<div class="grid grid-cols-1 sm:grid-cols-12 gap-2">
				<label class="label sm:col-span-4">
					<span class="label-text text-[0.7rem] font-bold uppercase opacity-70 ml-1">Nome completo</span>
					<input class="input py-1 px-3 text-sm" type="text" bind:value={nome} required />
				</label>
				<label class="label sm:col-span-2">
					<span class="label-text text-[0.7rem] font-bold uppercase opacity-70 ml-1">Matrícula</span>
					<input class="input py-1 px-3 text-sm" type="text" bind:value={matricula} required />
				</label>
				<label class="label sm:col-span-3">
					<span class="label-text text-[0.7rem] font-bold uppercase opacity-70 ml-1">Cargo</span>
					<select class="select py-1 px-3 text-sm" bind:value={cargo}>
						<option value="DPC">DPC - Delegado</option>
						<option value="OIP">OIP - Investigador</option>
					</select>
				</label>
				<label class="label sm:col-span-3">
					<span class="label-text text-[0.7rem] font-bold uppercase opacity-70 ml-1">Telefone</span>
					<input class="input py-1 px-3 text-sm" type="text" value={telefone} oninput={(e) => (telefone = formatarTelefone(e.currentTarget.value))} placeholder="(00) 0.0000-0000" />
				</label>
			</div>

			<!-- Linha 2 -->
			<div class="grid grid-cols-1 sm:grid-cols-12 gap-2">
				<label class="label sm:col-span-1">
					<span class="label-text text-[0.7rem] font-bold uppercase opacity-70 ml-1">Classe</span>
					<select class="select py-1 px-3 text-sm" bind:value={classe} required>
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
					<span class="label-text text-[0.7rem] font-bold uppercase opacity-70 ml-1">Regime de Trabalho</span>
					<select class="select py-1 px-3 text-sm" bind:value={regime}>
						<option value="ambos">Plantão e Expediente</option>
						<option value="plantao">Somente Plantão</option>
						<option value="expediente">Somente Expediente</option>
					</select>
				</label>
				<label class="label sm:col-span-7">
					<span class="label-text text-[0.7rem] font-bold uppercase opacity-70 ml-1">Lotação</span>
					{#if isAdmin}
						<select class="select py-1 px-3 text-sm" bind:value={lotacao}>
							<option value="">— Sem lotação —</option>
							{#each unidades as u (u)}
								<option value={u}>{u}</option>
							{/each}
						</select>
					{:else}
						<input class="input py-1 px-3 text-sm bg-surface-200 dark:bg-surface-800 cursor-not-allowed opacity-75" type="text" value={lotacao} readonly />
					{/if}
				</label>
			</div>

			<div class="flex gap-2 pt-1 border-t border-surface-200 dark:border-white/5 mt-2">
				<button type="submit" class="btn btn-sm sm:btn-md preset-filled-primary-500" disabled={saving}>
					{saving ? 'Guardando...' : 'Salvar'}
				</button>
				<a href="/policiais" class="btn btn-sm preset-outlined-primary-500">Cancelar</a>
			</div>
		</form>
	</div>

	{#if isAdminOrSeccional}
		<div class="p-3 sm:p-4 rounded-xl bg-white/80 dark:bg-surface-900/60 backdrop-blur-md border border-surface-200 dark:border-white/5 shadow-xl shadow-black/5 dark:shadow-black/20 mt-4">
			<h2 class="text-base font-bold mb-3 text-surface-700 dark:text-surface-300">Papel Administrativo</h2>
			<form onsubmit={salvarPapel} class="space-y-3">
				<div class="grid grid-cols-1 sm:grid-cols-12 gap-2">
					<label class="label sm:col-span-5">
						<span class="label-text text-[0.7rem] font-bold uppercase opacity-70 ml-1">Papel</span>
						<select class="select py-1 px-3 text-sm" bind:value={papel}>
							<option value={null}>Servidor (sem papel)</option>
							{#if isAdmin}
								<option value="admin_seccional">Admin Seccional</option>
							{/if}
							<option value="admin_unidade">Admin Unidade</option>
						</select>
					</label>
					{#if papel}
						<label class="label sm:col-span-7">
							<span class="label-text text-[0.7rem] font-bold uppercase opacity-70 ml-1">
								{papel === 'admin_seccional' ? 'Seccional de responsabilidade' : 'Unidade de responsabilidade'}
							</span>
							<select class="select py-1 px-3 text-sm" bind:value={papelUnidadeId}>
								<option value={null}>Selecionar...</option>
								{#each (papel === 'admin_seccional' ? seccionaisParaPapel : todasUnidadesObj) as u}
									<option value={u.id}>{u.nome} ({u.tipo})</option>
								{/each}
							</select>
						</label>
					{/if}
				</div>
				<div class="flex gap-2 pt-1 border-t border-surface-200 dark:border-white/5 mt-2">
					<button type="submit" class="btn btn-sm preset-filled-primary-500" disabled={salvandoPapel}>
						{salvandoPapel ? 'Salvando...' : 'Salvar papel'}
					</button>
				</div>
			</form>
		</div>
	{/if}


{/if}
