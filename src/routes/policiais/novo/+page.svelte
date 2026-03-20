<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { toaster } from '$lib/toast';

	const isAdmin = $derived(page.data.usuario?.tipo === 'admin');

	let nome = $state('');
	let matricula = $state('');
	let cargo = $state<'DPC' | 'OIP'>('OIP');
	let telefone = $state('');
	let lotacao = $state(
		page.data.usuario?.tipo === 'policial' ? (page.data.usuario.lotacao ?? '') : ''
	);
	let saving = $state(false);

	async function salvar(e: Event) {
		e.preventDefault();
		saving = true;

		const res = await fetch('/api/policiais', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ nome, matricula, cargo, telefone, lotacao })
		});

		if (res.ok) {
			toaster.create({ title: 'Policial cadastrado com sucesso!', type: 'success' });
			goto('/policiais');
		} else {
			const data = await res.json();
			toaster.create({ title: data.error || 'Erro ao cadastrar', type: 'error' });
		}
		saving = false;
	}
</script>

<div class="flex items-center justify-between mb-6">
	<h1 class="h1 text-xl font-bold">Novo Policial</h1>
	<a href="/policiais" class="btn preset-outlined-primary-500">Voltar</a>
</div>

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
				<input class="input" type="text" bind:value={telefone} placeholder="(00) 0.0000-0000" />
			</label>
		</div>
		<label class="label">
			<span class="label-text">Lotação</span>
			{#if isAdmin}
				<input class="input" type="text" bind:value={lotacao} required placeholder="Ex: DELEGACIA DE POLÍCIA CIVIL DE ICÓ" />
			{:else}
				<input class="input bg-surface-200 dark:bg-surface-800 cursor-not-allowed opacity-75" type="text" value={lotacao} readonly />
			{/if}
		</label>
		<div class="flex gap-3 pt-2">
			<button type="submit" class="btn preset-filled-primary-500" disabled={saving}>
				{saving ? 'Salvando...' : 'Cadastrar'}
			</button>
			<a href="/policiais" class="btn preset-outlined-primary-500">Cancelar</a>
		</div>
	</form>
</div>
