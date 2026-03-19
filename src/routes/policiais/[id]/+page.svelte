<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import type { Policial } from '$lib/types';

	const usuario = $derived($page.data.usuario);
	const isAdmin = $derived(usuario?.tipo === 'admin');

	let policial = $state<Policial | null>(null);
	let nome = $state('');
	let matricula = $state('');
	let cargo = $state<'DPC' | 'OIP'>('OIP');
	let telefone = $state('');
	let lotacao = $state('');
	let error = $state('');
	let saving = $state(false);
	let loading = $state(true);

	$effect(() => {
		const id = $page.params.id;
		fetch(`/api/policiais/${id}`)
			.then(r => r.json())
			.then((data: Policial) => {
				policial = data;
				nome = data.nome;
				matricula = data.matricula;
				cargo = data.cargo;
				telefone = data.telefone;
				lotacao = data.lotacao;
				loading = false;
			});
	});

	async function salvar(e: Event) {
		e.preventDefault();
		saving = true;
		error = '';

		const res = await fetch(`/api/policiais/${$page.params.id}`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ nome, matricula, cargo, telefone, lotacao })
		});

		if (res.ok) {
			goto('/policiais');
		} else {
			const data = await res.json();
			error = data.error || 'Erro ao salvar';
		}
		saving = false;
	}
</script>

<div class="flex items-center justify-between mb-6">
	<h1 class="h1 text-xl font-bold">Editar Policial</h1>
	<a href="/policiais" class="btn preset-outlined-primary-500">Voltar</a>
</div>

{#if error}
	<aside class="preset-filled-error-500 p-3 rounded-lg text-sm mb-4">{error}</aside>
{/if}

{#if loading}
	<p class="text-center py-8">Carregando...</p>
{:else}
	<div class="card p-6">
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
			<label class="label">
				<span class="label-text">Lotação</span>
				{#if isAdmin}
					<input class="input" type="text" bind:value={lotacao} required />
				{:else}
					<input class="input bg-surface-100 cursor-not-allowed" type="text" value={lotacao} readonly />
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
