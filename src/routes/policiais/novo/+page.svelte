<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';

	const usuario = $derived($page.data.usuario);
	const isAdmin = $derived(usuario?.tipo === 'admin');

	let nome = $state('');
	let matricula = $state('');
	let cargo = $state<'DPC' | 'OIP'>('OIP');
	let telefone = $state('');
	let lotacao = $state('');
	let error = $state('');
	let saving = $state(false);

	$effect(() => {
		if (usuario?.tipo === 'policial' && usuario.lotacao) {
			lotacao = usuario.lotacao;
		}
	});

	async function salvar(e: Event) {
		e.preventDefault();
		saving = true;
		error = '';

		const res = await fetch('/api/policiais', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ nome, matricula, cargo, telefone, lotacao })
		});

		if (res.ok) {
			goto('/policiais');
		} else {
			const data = await res.json();
			error = data.error || 'Erro ao cadastrar';
		}
		saving = false;
	}
</script>

<div class="page-header">
	<h1>Novo Policial</h1>
	<a href="/policiais" class="btn btn-outline">Voltar</a>
</div>

{#if error}
	<div class="alert alert-error">{error}</div>
{/if}

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
				<input id="telefone" type="text" bind:value={telefone} placeholder="(00) 0.0000-0000" />
			</div>
		</div>
		<div class="form-group">
			<label for="lotacao">Lotação</label>
			{#if isAdmin}
				<input id="lotacao" type="text" bind:value={lotacao} required placeholder="Ex: DELEGACIA DE POLÍCIA CIVIL DE ICÓ" />
			{:else}
				<input id="lotacao" type="text" value={lotacao} readonly style="background: #f3f4f6; cursor: not-allowed;" />
			{/if}
		</div>
		<div class="actions" style="margin-top: 1rem;">
			<button type="submit" class="btn btn-primary" disabled={saving}>
				{saving ? 'Salvando...' : 'Cadastrar'}
			</button>
			<a href="/policiais" class="btn btn-outline">Cancelar</a>
		</div>
	</form>
</div>
