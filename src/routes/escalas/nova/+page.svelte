<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';

	const horas = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));

	let titulo = $state('');
	let cidade = $state('');
	let dataInicio = $state('');
	let dataFim = $state('');
	let horaEntrada = $state('08');
	let horaSaida = $state('08');
	let error = $state('');
	let saving = $state(false);
	let lotacoes = $state<string[]>([]);

	onMount(async () => {
		try {
			const res = await fetch('/api/lotacoes');
			if (res.ok) {
				lotacoes = await res.json();
			}
		} catch {
			// Silently fail — user can still type manually
		}
	});

	function horarioLabel(): string {
		return `${horaEntrada}H A ${horaSaida}H`;
	}

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
				horario: horarioLabel(),
				hora_entrada: horaEntrada,
				hora_saida: horaSaida
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
			{#if lotacoes.length > 0}
				<select id="cidade" bind:value={cidade} required>
					<option value="" disabled selected>Selecione a lotação</option>
					{#each lotacoes as lotacao}
						<option value={lotacao}>{lotacao}</option>
					{/each}
				</select>
			{:else}
				<input id="cidade" type="text" bind:value={cidade} required placeholder="Ex: ICÓ" />
			{/if}
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
		<div class="form-row">
			<div class="form-group">
				<label for="hora_entrada">Hora de entrada (padrão)</label>
				<select id="hora_entrada" bind:value={horaEntrada}>
					{#each horas as h}
						<option value={h}>{h}h</option>
					{/each}
				</select>
			</div>
			<div class="form-group">
				<label for="hora_saida">Hora de saída (padrão)</label>
				<select id="hora_saida" bind:value={horaSaida}>
					{#each horas as h}
						<option value={h}>{h}h</option>
					{/each}
				</select>
			</div>
		</div>
		<p class="horario-preview">
			Horário do plantão: <strong>{horarioLabel()}</strong>
			{#if Number(horaSaida) <= Number(horaEntrada) && horaEntrada !== horaSaida}
				<span class="hint"> (cruza para o dia seguinte)</span>
			{:else if horaEntrada === horaSaida}
				<span class="hint"> (plantão de 24h)</span>
			{/if}
		</p>
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

<style>
	.horario-preview {
		margin: 0 0 1rem;
		font-size: 0.9rem;
		color: var(--text-light, #64748b);
	}

	.hint {
		font-size: 0.8rem;
		font-style: italic;
	}
</style>
