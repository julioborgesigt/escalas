<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
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

	const isAdmin = $derived(page.data.usuario?.tipo === 'admin');

	$effect(() => {
		fetch('/api/lotacoes')
			.then(r => r.ok ? r.json() : [])
			.then((data: string[]) => { lotacoes = data; })
			.catch(() => {});
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

	function onCidadeChange() {
		if (isAdmin) lotacaoEscala = cidade;
		gerarTitulo();
	}
</script>

<div class="flex items-center justify-between mb-6">
	<h1 class="h1 text-xl font-bold">Nova Escala</h1>
	<a href="/escalas" class="btn preset-outlined-primary-500">Voltar</a>
</div>

<div class="p-6 rounded-3xl bg-white/80 dark:bg-surface-900/60 backdrop-blur-md border border-surface-200 dark:border-white/5 shadow-xl shadow-black/5 dark:shadow-black/20 mt-6">
	<form onsubmit={salvar} class="space-y-4">
		<!-- Linha principal: Cidade + datas + horas numa única fila -->
		<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_auto_1fr_auto] gap-3 items-end">
			<label class="label">
				<span class="label-text">Cidade</span>
				{#if lotacoes.length > 0}
					<select class="select" bind:value={cidade} onchange={onCidadeChange} required>
						<option value="" disabled selected>Selecione...</option>
						{#each lotacoes as lot (lot)}
							<option value={lot}>{lot}</option>
						{/each}
					</select>
				{:else}
					<input class="input" type="text" bind:value={cidade} oninput={onCidadeChange} required placeholder="Ex: ICÓ" />
				{/if}
			</label>
			<label class="label">
				<span class="label-text">Data início</span>
				<input class="input" type="date" bind:value={dataInicio} onchange={gerarTitulo} required />
			</label>
			<label class="label">
				<span class="label-text">Hora de entrada</span>
				<select class="select" bind:value={horaEntrada}>
					{#each horas as h (h)}<option value={h}>{h}h</option>{/each}
				</select>
			</label>
			<label class="label">
				<span class="label-text">Data fim</span>
				<input class="input" type="date" bind:value={dataFim} onchange={gerarTitulo} required />
			</label>
			<label class="label">
				<span class="label-text">Hora de saída</span>
				<select class="select" bind:value={horaSaida}>
					{#each horas as h (h)}<option value={h}>{h}h</option>{/each}
				</select>
			</label>
		</div>

		<p class="text-sm text-primary-600 dark:text-primary-400">
			Horário do plantão: <strong>{horarioLabel()}</strong>
			{#if Number(horaSaida) <= Number(horaEntrada) && horaEntrada !== horaSaida}
				<span class="italic text-surface-500"> (cruza para o dia seguinte)</span>
			{:else if horaEntrada === horaSaida}
				<span class="italic text-surface-500"> (plantão de 24h)</span>
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
