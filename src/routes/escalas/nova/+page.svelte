<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { toaster } from '$lib/toast';
	import type { Escala } from '$lib/types';

	const horas = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));

	let titulo = $state('');
	let cidade = $state('');
	let dataInicio = $state('');
	let dataFim = $state('');
	let horaEntrada = $state('08');
	let horaSaida = $state('08');
	let saving = $state(false);
	let lotacoes = $state<string[]>([]);
	let lotacaoEscala = $state('');

	const usuario = $derived($page.data.usuario);
	const isAdmin = $derived(usuario?.tipo === 'admin');

	onMount(async () => {
		try {
			const res = await fetch('/api/lotacoes');
			if (res.ok) {
				lotacoes = await res.json();
			}
		} catch {
			// Silently fail
		}
	});

	function horarioLabel(): string {
		return `${horaEntrada}H A ${horaSaida}H`;
	}

	async function salvar(e: Event) {
		e.preventDefault();
		saving = true;

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
				hora_saida: horaSaida,
				lotacao: isAdmin ? lotacaoEscala : undefined
			})
		});

		if (res.ok) {
			const data = await res.json();
			toaster.create({ title: 'Escala criada com sucesso', type: 'success' });
			goto(`/escalas/${data.id}`);
		} else {
			const data = await res.json();
			toaster.create({ title: data.error || 'Erro ao criar', type: 'error' });
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

<div class="flex items-center justify-between mb-6">
	<h1 class="h1 text-xl font-bold">Nova Escala</h1>
	<a href="/escalas" class="btn preset-outlined-primary-500">Voltar</a>
</div>

<div class="card p-6">
	<form onsubmit={salvar} class="space-y-4">
		{#if isAdmin}
			<label class="label">
				<span class="label-text">Lotação (unidade policial)</span>
				<select class="select" bind:value={lotacaoEscala} required>
					<option value="" disabled selected>Selecione a lotação</option>
					{#each lotacoes as lot}
						<option value={lot}>{lot}</option>
					{/each}
				</select>
			</label>
		{/if}

		<label class="label">
			<span class="label-text">Cidade</span>
			{#if lotacoes.length > 0}
				<select class="select" bind:value={cidade} required>
					<option value="" disabled selected>Selecione a lotação</option>
					{#each lotacoes as lotacao}
						<option value={lotacao}>{lotacao}</option>
					{/each}
				</select>
			{:else}
				<input class="input" type="text" bind:value={cidade} required placeholder="Ex: ICÓ" />
			{/if}
		</label>

		<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
			<label class="label">
				<span class="label-text">Data início</span>
				<input class="input" type="date" bind:value={dataInicio} required />
			</label>
			<label class="label">
				<span class="label-text">Data fim</span>
				<input class="input" type="date" bind:value={dataFim} required />
			</label>
		</div>

		<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
			<label class="label">
				<span class="label-text">Hora de entrada (padrão)</span>
				<select class="select" bind:value={horaEntrada}>
					{#each horas as h}
						<option value={h}>{h}h</option>
					{/each}
				</select>
			</label>
			<label class="label">
				<span class="label-text">Hora de saída (padrão)</span>
				<select class="select" bind:value={horaSaida}>
					{#each horas as h}
						<option value={h}>{h}h</option>
					{/each}
				</select>
			</label>
		</div>

		<p class="text-sm text-surface-500">
			Horário do plantão: <strong>{horarioLabel()}</strong>
			{#if Number(horaSaida) <= Number(horaEntrada) && horaEntrada !== horaSaida}
				<span class="italic"> (cruza para o dia seguinte)</span>
			{:else if horaEntrada === horaSaida}
				<span class="italic"> (plantão de 24h)</span>
			{/if}
		</p>

		<label class="label">
			<span class="label-text">Título (gerado automaticamente)</span>
			<input class="input" type="text" bind:value={titulo} required />
		</label>

		<div class="flex gap-3 pt-2">
			<button type="submit" class="btn preset-filled-primary-500" disabled={saving}>
				{saving ? 'Criando...' : 'Criar Escala'}
			</button>
			<a href="/escalas" class="btn preset-outlined-primary-500">Cancelar</a>
		</div>
	</form>
</div>
