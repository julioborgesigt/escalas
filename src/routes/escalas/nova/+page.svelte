<script lang="ts">
	import { goto } from '$app/navigation';

	let titulo = $state('');
	let cidade = $state('');
	let dataInicio = $state('');
	let dataFim = $state('');
	let horario = $state('08H A 08H');
	let error = $state('');
	let saving = $state(false);

	async function salvar(e: Event) {
		e.preventDefault();
		saving = true;
		error = '';

		const res = await fetch('/api/escalas', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				titulo,
				cidade,
				data_inicio: dataInicio,
				data_fim: dataFim,
				horario
			})
		});

		if (res.ok) {
			const data = await res.json();
			goto(`/escalas/${data.id}`);
		} else {
			const data = await res.json();
			error = data.error || 'Erro ao criar escala';
		}
		saving = false;
	}

	function gerarTitulo() {
		if (cidade && dataInicio && dataFim) {
			const di = dataInicio.split('-');
			const df = dataFim.split('-');
			titulo = `ESCALA PLANTÃO FINAL DE SEMANA ${cidade.toUpperCase()} ${di[2]}/${di[1]}/${di[0]} E ${df[2]}/${df[1]}/${df[0]}`;
		}
	}

	$effect(() => {
		cidade; dataInicio; dataFim;
		gerarTitulo();
	});
</script>

<div class="page-header">
	<h1>Nova Escala</h1>
	<a href="/escalas" class="btn btn-outline">Voltar</a>
</div>

{#if error}
	<div class="alert alert-error">{error}</div>
{/if}

<div class="card">
	<form onsubmit={salvar}>
		<div class="form-group">
			<label for="cidade">Cidade</label>
			<input id="cidade" type="text" bind:value={cidade} required placeholder="Ex: ICÓ" />
		</div>
		<div class="form-row">
			<div class="form-group">
				<label for="data_inicio">Data início</label>
				<input id="data_inicio" type="date" bind:value={dataInicio} required />
			</div>
			<div class="form-group">
				<label for="data_fim">Data fim</label>
				<input id="data_fim" type="date" bind:value={dataFim} required />
			</div>
		</div>
		<div class="form-group">
			<label for="horario">Horário do plantão</label>
			<input id="horario" type="text" bind:value={horario} placeholder="08H A 08H" />
		</div>
		<div class="form-group">
			<label for="titulo">Título (gerado automaticamente)</label>
			<input id="titulo" type="text" bind:value={titulo} required />
		</div>
		<div class="actions" style="margin-top: 1rem;">
			<button type="submit" class="btn btn-primary" disabled={saving}>
				{saving ? 'Criando...' : 'Criar Escala'}
			</button>
			<a href="/escalas" class="btn btn-outline">Cancelar</a>
		</div>
	</form>
</div>
