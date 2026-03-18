<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import type { Policial } from '$lib/types';

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

<div class="page-header">
	<h1>Editar Policial</h1>
	<a href="/policiais" class="btn btn-outline">Voltar</a>
</div>

{#if error}
	<div class="alert alert-error">{error}</div>
{/if}

{#if loading}
	<p style="text-align: center; padding: 2rem;">Carregando...</p>
{:else}
	<div class="card">
		<form onsubmit={salvar}>
			<div class="form-row">
				<div class="form-group">
					<label for="nome">Nome completo</label>
					<input id="nome" type="text" bind:value={nome} required />
				</div>
				<div class="form-group">
					<label for="matricula">Matrícula</label>
					<input id="matricula" type="text" bind:value={matricula} required />
				</div>
			</div>
			<div class="form-row">
				<div class="form-group">
					<label for="cargo">Cargo</label>
					<select id="cargo" bind:value={cargo}>
						<option value="DPC">DPC - Delegado de Polícia Civil</option>
						<option value="OIP">OIP - Oficial Investigador de Polícia</option>
					</select>
				</div>
				<div class="form-group">
					<label for="telefone">Telefone</label>
					<input id="telefone" type="text" bind:value={telefone} />
				</div>
			</div>
			<div class="form-group">
				<label for="lotacao">Lotação</label>
				<input id="lotacao" type="text" bind:value={lotacao} required />
			</div>
			<div class="actions" style="margin-top: 1rem;">
				<button type="submit" class="btn btn-primary" disabled={saving}>
					{saving ? 'Salvando...' : 'Salvar'}
				</button>
				<a href="/policiais" class="btn btn-outline">Cancelar</a>
			</div>
		</form>
	</div>
{/if}
