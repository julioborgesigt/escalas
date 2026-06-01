<script lang="ts">
	import { enhance } from '$app/forms';
	import { toaster } from '$lib/toast';
	import { formatarData, proximoDia } from '$lib/utils';
	import SearchableSelect from '$lib/components/SearchableSelect.svelte';
	import type { ActionResult } from '@sveltejs/kit';
	import type { Escala } from '$lib/server/schema';
	import type { EscalaPolicialComDados } from '$lib/types';

	const {
		escala,
		isFDS,
		isExpediente,
		diasEscalaLocal,
		modoEdicao,
		documentoAssinadoExiste,
		finalizadaEm,
		solicitacaoAtual,
		onPoliciaisAtualizados
	}: {
		escala: Escala;
		isFDS: boolean;
		isExpediente: boolean;
		diasEscalaLocal: string[];
		modoEdicao: boolean;
		documentoAssinadoExiste: boolean;
		finalizadaEm: string | null;
		solicitacaoAtual: { tipo: string } | null;
		onPoliciaisAtualizados: (policiais: EscalaPolicialComDados[]) => void;
	} = $props();

	const horas = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
	const minutos = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));

	let cargoBusca = $state<'DPC' | 'OIP' | ''>('');
	let policialId = $state('');
	let dataPlantao = $state('');

	$effect(() => {
		dataPlantao = escala.data_inicio ?? '';
	});
	let addHoraEntrada = $state('08');
	let addMinutoEntrada = $state('00');
	let addHoraSaida = $state('08');
	let addMinutoSaida = $state('00');
	let addEquipe = $state('1');
	let addTipoEscala = $state<'1x3' | '2x6'>('1x3');
	let addPrimeiroPlantao = $state('');
	let addDatasSelecionadas = $state<string[]>([]);
	let addObservacoes = $state('');

	let pendingAdd = $state(false);
	let pendingPlantao = $state(false);
	let pendingAdicionarTodos = $state(false);

	async function buscarPoliciaisAsync(q: string, sig: AbortSignal) {
		if (!cargoBusca) return [];
		const params = new URLSearchParams({ cargo: cargoBusca, limit: '50' });
		if (q) params.set('q', q);
		const res = await fetch(`/api/policiais/search?${params}`, { signal: sig });
		if (!res.ok) {
			const err = await res.json().catch(() => ({ error: 'Erro na busca' }));
			throw new Error(err.error ?? 'Erro na busca');
		}
		const json = (await res.json()) as {
			policiais: { id: number; nome: string; lotacao: string }[];
		};
		return json.policiais.map((p) => ({
			value: String(p.id),
			label: `${p.nome}${p.lotacao ? ' — ' + p.lotacao : ''}`
		}));
	}

	function calcularDataSaidaInicial(de: string, he: string, hs: string): string {
		const hEnt = Number(he.split(':')[0]);
		const hSai = Number(hs.split(':')[0]);
		if (hSai <= hEnt) return proximoDia(de);
		return de;
	}

	function calcularDatasPlantao(primeiroPlantao: string, tipo: '1x3' | '2x6'): string[] {
		if (!primeiroPlantao) return [];
		const datas: string[] = [];
		const inicio = new Date(escala.data_inicio + 'T00:00:00');
		const fim = new Date(escala.data_fim + 'T00:00:00');
		const d = new Date(primeiroPlantao + 'T00:00:00');
		if (tipo === '1x3') {
			while (d <= fim) {
				if (d >= inicio) datas.push(d.toISOString().split('T')[0]);
				d.setDate(d.getDate() + 4);
			}
		} else {
			while (d <= fim) {
				if (d >= inicio) datas.push(d.toISOString().split('T')[0]);
				const d2 = new Date(d);
				d2.setDate(d2.getDate() + 1);
				if (d2 <= fim && d2 >= inicio) datas.push(d2.toISOString().split('T')[0]);
				d.setDate(d.getDate() + 8);
			}
		}
		return datas;
	}

	function toggleDataPlantao(data: string) {
		const idx = addDatasSelecionadas.indexOf(data);
		if (idx >= 0) addDatasSelecionadas = addDatasSelecionadas.filter((d) => d !== data);
		else addDatasSelecionadas = [...addDatasSelecionadas, data].sort();
	}

	const datasCalc = $derived(calcularDatasPlantao(addPrimeiroPlantao, addTipoEscala));

	$effect(() => {
		addDatasSelecionadas = datasCalc;
	});

	const datasPlantaoJson = $derived(
		JSON.stringify(
			addDatasSelecionadas.map((d) => ({
				data_plantao: d,
				data_saida: calcularDataSaidaInicial(
					d,
					`${addHoraEntrada}:${addMinutoEntrada}`,
					`${addHoraSaida}:${addMinutoSaida}`
				)
			}))
		)
	);

	function handleAdd({ cancel }: { cancel: () => void }) {
		if (!policialId) {
			cancel();
			return;
		}
		pendingAdd = true;
		return async ({ result }: { result: ActionResult }) => {
			pendingAdd = false;
			if (result.type === 'success') {
				onPoliciaisAtualizados(result.data?.policiais);
				toaster.create({ title: 'Policial adicionado à escala', type: 'success' });
				cargoBusca = '';
				policialId = '';
				addObservacoes = '';
			} else if (result.type === 'error') {
				toaster.create({ title: 'Erro de conexão. Tente novamente.', type: 'error' });
			} else {
				const d =
					result.type === 'failure'
						? (result.data as Record<string, unknown> | undefined)
						: undefined;
				toaster.create({ title: String(d?.error || 'Erro ao adicionar'), type: 'error' });
			}
		};
	}

	function handlePlantao({ cancel }: { cancel: () => void }) {
		if (!policialId || addDatasSelecionadas.length === 0) {
			cancel();
			return;
		}
		pendingPlantao = true;
		return async ({ result }: { result: ActionResult }) => {
			pendingPlantao = false;
			if (result.type === 'success') {
				onPoliciaisAtualizados(result.data?.policiais);
				const conflitantes =
					(result.data?.conflitantes as { data: string; motivo: string }[] | undefined) ?? [];
				if (conflitantes.length > 0) {
					const datas = conflitantes.map((c) => c.data).join(', ');
					toaster.create({
						title: `Adicionado — ${conflitantes.length} dia(s) com choque ignorado(s)`,
						description: `Dias ignorados: ${datas}`,
						type: 'warning'
					});
				} else {
					toaster.create({ title: 'Servidor adicionado à escala de plantão', type: 'success' });
				}
				cargoBusca = '';
				policialId = '';
				addPrimeiroPlantao = '';
				addEquipe = '1';
				addDatasSelecionadas = [];
			} else if (result.type === 'error') {
				toaster.create({ title: 'Erro de conexão. Tente novamente.', type: 'error' });
			} else {
				const d =
					result.type === 'failure'
						? (result.data as Record<string, unknown> | undefined)
						: undefined;
				toaster.create({ title: String(d?.error || 'Erro ao adicionar'), type: 'error' });
			}
		};
	}

	function handleAdicionarTodos() {
		pendingAdicionarTodos = true;
		return async ({ result }: { result: ActionResult }) => {
			pendingAdicionarTodos = false;
			if (result.type === 'success') {
				const d = result.data as Record<string, unknown> | undefined;
				onPoliciaisAtualizados(result.data?.policiais);
				if (Number(d?.quantidade) === 0)
					toaster.create({ title: 'Todos os servidores já estão na escala', type: 'warning' });
				else
					toaster.create({ title: `${d?.quantidade} servidor(es) adicionado(s)`, type: 'success' });
			} else if (result.type === 'error') {
				toaster.create({ title: 'Erro de conexão. Tente novamente.', type: 'error' });
			} else {
				const d =
					result.type === 'failure'
						? (result.data as Record<string, unknown> | undefined)
						: undefined;
				toaster.create({ title: String(d?.error || 'Erro'), type: 'error' });
			}
		};
	}

	const visivel = $derived(
		modoEdicao && !documentoAssinadoExiste && !finalizadaEm && !solicitacaoAtual
	);
</script>

{#if visivel && isExpediente}
	<div
		class="p-4 sm:p-5 mb-4 rounded-3xl bg-primary-500/8 border border-primary-500/25 backdrop-blur-md shadow-xl shadow-black/5 dark:shadow-black/20"
	>
		<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
			<div>
				<h3 class="font-semibold text-sm text-primary-700 dark:text-primary-400">
					Adicionar Todos os Servidores do Expediente
				</h3>
				<p class="text-xs text-surface-500 mt-1">
					Adiciona automaticamente todos os servidores cadastrados com regime de expediente da {escala.lotacao}
					que ainda não estão na escala.
				</p>
			</div>
			<form
				method="POST"
				action="?/adicionarTodos"
				use:enhance={handleAdicionarTodos}
				class="contents"
			>
				<button
					type="submit"
					class="btn preset-filled-primary-500 shrink-0 font-semibold flex items-center gap-2 active:scale-95 transition-all"
					disabled={pendingAdicionarTodos}
				>
					{pendingAdicionarTodos ? 'Adicionando...' : '+ Adicionar Todos'}
				</button>
			</form>
		</div>
	</div>
{/if}

{#if visivel && !isFDS}
	<div
		class="p-4 sm:p-6 mb-4 rounded-3xl bg-white/80 dark:bg-surface-900/60 backdrop-blur-md border border-surface-200 dark:border-white/5 shadow-xl shadow-black/5 dark:shadow-black/20"
	>
		<h3 class="font-semibold text-sm mb-3">Adicionar DPC/OIP à Escala</h3>
		{#if escala.tipo === 'plantao'}
			<form method="POST" action="?/adicionarPlantao" use:enhance={handlePlantao}>
				<input type="hidden" name="datas" value={datasPlantaoJson} />
				<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
					<label class="label">
						<span class="label-text">Cargo</span>
						<select
							class="select"
							bind:value={cargoBusca}
							onchange={() => {
								policialId = '';
							}}
						>
							<option value="">Selecione...</option>
							<option value="DPC">DPC - Delegado de Polícia Civil</option>
							<option value="OIP">OIP - Oficial Investigador de Polícia</option>
						</select>
					</label>
					<label class="label lg:col-span-2">
						<span class="label-text">Servidor</span>
						{#key cargoBusca}
							<SearchableSelect
								name="policial_id"
								bind:value={policialId}
								disabled={!cargoBusca}
								loadOptions={buscarPoliciaisAsync}
								placeholder={cargoBusca
									? 'Digite para buscar servidor...'
									: 'Selecione o cargo primeiro'}
								class="w-full"
							/>
						{/key}
					</label>
					<label class="label">
						<span class="label-text">Equipe</span>
						<select class="select" name="equipe" bind:value={addEquipe}>
							{#each ['1', '2', '3', '4', '5'] as n (n)}<option value={n}>Equipe {n}</option>{/each}
						</select>
					</label>
					<label class="label">
						<span class="label-text">Tipo de Escala</span>
						<select class="select" bind:value={addTipoEscala}>
							<option value="1x3">1×3 — 24h serviço, 3 dias folga</option>
							<option value="2x6">2×6 — 48h serviço, 6 dias folga</option>
						</select>
					</label>
				</div>
				<div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
					<label class="label">
						<span class="label-text">Primeiro plantão do mês</span>
						<input
							type="date"
							class="input"
							bind:value={addPrimeiroPlantao}
							min={escala.data_inicio}
							max={escala.data_fim}
							required
						/>
					</label>
					<div class="flex flex-col gap-1">
						<span class="label-text text-xs">Hora Entrada</span>
						<div class="flex gap-1">
							<select
								class="select flex-1 h-9 py-0 px-2"
								name="hora_entrada"
								bind:value={addHoraEntrada}
								>{#each horas as h (h)}<option value={h}>{h}h</option>{/each}</select
							>
							<select
								class="select flex-1 h-9 py-0 px-2"
								name="minuto_entrada"
								bind:value={addMinutoEntrada}
								>{#each minutos as m (m)}<option value={m}>{m}m</option>{/each}</select
							>
						</div>
					</div>
					<div class="flex flex-col gap-1">
						<span class="label-text text-xs">Hora Saída</span>
						<div class="flex gap-1">
							<select
								class="select flex-1 h-9 py-0 px-2"
								name="hora_saida"
								bind:value={addHoraSaida}
								>{#each horas as h (h)}<option value={h}>{h}h</option>{/each}</select
							>
							<select
								class="select flex-1 h-9 py-0 px-2"
								name="minuto_saida"
								bind:value={addMinutoSaida}
								>{#each minutos as m (m)}<option value={m}>{m}m</option>{/each}</select
							>
						</div>
					</div>
				</div>
				{#if addPrimeiroPlantao}
					<div class="mb-4">
						<p class="text-xs font-semibold text-surface-600 dark:text-surface-400 mb-2">
							Datas calculadas ({datasCalc.length} dias):
						</p>
						<div class="flex flex-wrap gap-1.5">
							{#each datasCalc as d}
								<button
									type="button"
									class="px-2 py-1 text-[0.65rem] font-bold rounded-md border transition-all {addDatasSelecionadas.includes(
										d
									)
										? 'bg-primary-500 text-white border-primary-500'
										: 'bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-400 border-surface-200 dark:border-white/10 hover:border-primary-500/50'}"
									onclick={() => toggleDataPlantao(d)}>{formatarData(d)}</button
								>
							{/each}
						</div>
					</div>
				{/if}
				<button
					type="submit"
					class="btn preset-filled-primary-500 w-full sm:w-auto active:scale-95 transition-all"
					disabled={pendingPlantao || !policialId || addDatasSelecionadas.length === 0}
				>
					{pendingPlantao ? 'Adicionando...' : 'Adicionar à Escala'}
				</button>
			</form>
		{:else if isExpediente}
			<form method="POST" action="?/adicionar" use:enhance={handleAdd}>
				<input type="hidden" name="data_plantao" value={escala.data_inicio} />
				<input type="hidden" name="data_saida_override" value={escala.data_fim} />
				<input type="hidden" name="hora_entrada" value="00" />
				<input type="hidden" name="minuto_entrada" value="00" />
				<input type="hidden" name="hora_saida" value="23" />
				<input type="hidden" name="minuto_saida" value="59" />
				<input type="hidden" name="equipe" value="1" />
				<div class="grid grid-cols-1 sm:grid-cols-12 gap-4 items-end">
					<label class="label sm:col-span-1">
						<span class="label-text">Cargo</span>
						<select
							class="select h-9 py-0 px-2"
							bind:value={cargoBusca}
							onchange={() => {
								policialId = '';
							}}
						>
							<option value="">...</option>
							<option value="DPC">DPC</option>
							<option value="OIP">OIP</option>
						</select>
					</label>
					<label class="label sm:col-span-4 self-center">
						<span class="label-text">Servidor</span>
						{#key cargoBusca}
							<SearchableSelect
								name="policial_id"
								bind:value={policialId}
								disabled={!cargoBusca}
								loadOptions={buscarPoliciaisAsync}
								placeholder={cargoBusca
									? 'Digite para buscar servidor...'
									: 'Selecione o cargo primeiro'}
								class="w-full h-9"
							/>
						{/key}
					</label>
					<label class="label sm:col-span-5">
						<span class="label-text">Observações</span>
						<input
							type="text"
							name="observacoes"
							class="input h-9"
							bind:value={addObservacoes}
							maxlength="500"
							placeholder="Informações complementares (opcional)"
						/>
					</label>
					<div class="sm:col-span-2">
						<button
							type="submit"
							class="btn preset-filled-primary-500 w-full active:scale-95 transition-all"
							disabled={pendingAdd || !policialId}
						>
							{pendingAdd ? 'Adicionando...' : '+ Adicionar'}
						</button>
					</div>
				</div>
			</form>
		{:else}
			<form method="POST" action="?/adicionar" use:enhance={handleAdd}>
				<div class="grid grid-cols-1 sm:grid-cols-12 gap-4 items-end mb-4">
					<label class="label sm:col-span-1">
						<span class="label-text">Cargo</span>
						<select
							class="select h-9 py-0 px-2"
							bind:value={cargoBusca}
							onchange={() => {
								policialId = '';
							}}
						>
							<option value="">...</option>
							<option value="DPC">DPC</option>
							<option value="OIP">OIP</option>
						</select>
					</label>
					<label class="label sm:col-span-3 self-center">
						<span class="label-text">Servidor</span>
						{#key cargoBusca}
							<SearchableSelect
								name="policial_id"
								bind:value={policialId}
								disabled={!cargoBusca}
								loadOptions={buscarPoliciaisAsync}
								placeholder={cargoBusca
									? 'Digite para buscar servidor...'
									: 'Selecione o cargo primeiro'}
								class="w-full h-9"
							/>
						{/key}
					</label>
					<label class="label sm:col-span-2">
						<span class="label-text">Data</span>
						<select
							name="data_plantao"
							class="select h-9 py-0 px-2"
							bind:value={dataPlantao}
							required
						>
							{#each diasEscalaLocal as d (d)}
								<option value={d}>{formatarData(d)}</option>
							{/each}
						</select>
					</label>
					<div class="sm:col-span-2">
						<span class="label-text text-xs">Entrada</span>
						<div class="flex gap-1">
							<select
								class="select flex-1 h-9 py-0 px-1"
								name="hora_entrada"
								bind:value={addHoraEntrada}
								>{#each horas as h (h)}<option value={h}>{h}h</option>{/each}</select
							>
							<select
								class="select flex-1 h-9 py-0 px-1"
								name="minuto_entrada"
								bind:value={addMinutoEntrada}
								>{#each minutos as m (m)}<option value={m}>{m}m</option>{/each}</select
							>
						</div>
					</div>
					<div class="sm:col-span-2">
						<span class="label-text text-xs">Saída</span>
						<div class="flex gap-1">
							<select
								class="select flex-1 h-9 py-0 px-1"
								name="hora_saida"
								bind:value={addHoraSaida}
								>{#each horas as h (h)}<option value={h}>{h}h</option>{/each}</select
							>
							<select
								class="select flex-1 h-9 py-0 px-1"
								name="minuto_saida"
								bind:value={addMinutoSaida}
								>{#each minutos as m (m)}<option value={m}>{m}m</option>{/each}</select
							>
						</div>
					</div>
					<input type="hidden" name="equipe" value="1" />
					<div class="sm:col-span-2">
						<button
							type="submit"
							class="btn preset-filled-primary-500 w-full active:scale-95 transition-all"
							disabled={pendingAdd || !policialId || !dataPlantao}
						>
							{pendingAdd ? 'Adicionando...' : '+ Adicionar'}
						</button>
					</div>
				</div>
			</form>
		{/if}
	</div>
{/if}
