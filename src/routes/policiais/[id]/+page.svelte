<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { toaster } from '$lib/toast';
	import type { Policial } from '$lib/types';

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
				loading = false;
			});

		if (isAdmin) {
			fetch('/api/lotacoes').then(r => r.json()).then((data: string[]) => {
				unidades = data;
			});
		}
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
</script>

<div class="flex items-center justify-between mb-6">
	<h1 class="h1 text-xl font-bold">Editar Policial</h1>
	<a href="/policiais" class="btn preset-outlined-primary-500">Voltar</a>
</div>

{#if loading}
	<p class="text-center py-8">Carregando...</p>
{:else}
	<div class="p-6 rounded-3xl bg-white/80 dark:bg-surface-900/60 backdrop-blur-md border border-surface-200 dark:border-white/5 shadow-xl shadow-black/5 dark:shadow-black/20">
		<form onsubmit={salvar} class="space-y-4">
			<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
				<label class="label">
					<span class="label-text">Nome completo</span>
					<input class="input" type="text" bind:value={nome} required />
				</label>
				<label class="label">
					<span class="label-text">Matrícula</span>
					<input class="input" type="text" bind:value={matricula} required />
				</label>
			</div>
			<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
				<label class="label">
					<span class="label-text">Cargo</span>
					<select class="select" bind:value={cargo}>
						<option value="DPC">DPC - Delegado de Polícia Civil</option>
						<option value="OIP">OIP - Oficial Investigador de Polícia</option>
					</select>
				</label>
				<label class="label">
					<span class="label-text">Telefone</span>
					<input class="input" type="text" bind:value={telefone} />
				</label>
			</div>
			<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
				<label class="label">
					<span class="label-text">Classe</span>
					<input class="input" type="text" bind:value={classe} placeholder="Ex: Especial, A I, B II, C III..." />
				</label>
				<label class="label">
					<span class="label-text">Regime de Trabalho</span>
					<select class="select" bind:value={regime}>
						<option value="ambos">Plantão e Expediente</option>
						<option value="plantao">Somente Plantão</option>
						<option value="expediente">Somente Expediente</option>
					</select>
				</label>
			</div>
			<label class="label">
				<span class="label-text">Lotação</span>
				{#if isAdmin}
					<select class="select" bind:value={lotacao}>
						<option value="">— Sem lotação —</option>
						{#each unidades as u (u)}
							<option value={u}>{u}</option>
						{/each}
					</select>
				{:else}
					<input class="input bg-surface-200 dark:bg-surface-800 cursor-not-allowed opacity-75" type="text" value={lotacao} readonly />
				{/if}
			</label>
			<div class="flex gap-3 pt-2">
				<button type="submit" class="btn preset-filled-primary-500" disabled={saving}>
					{saving ? 'Salvando...' : 'Salvar'}
				</button>
				<a href="/policiais" class="btn preset-outlined-primary-500">Cancelar</a>
			</div>
		</form>
	</div>
{/if}
