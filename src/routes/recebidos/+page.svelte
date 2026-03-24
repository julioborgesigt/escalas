<script lang="ts">
	import { page } from '$app/state';
	import { toaster } from '$lib/toast';
	import type { EscalaListagem, Unidade } from '$lib/types';

	const isAdmin = $derived(page.data.usuario?.tipo === 'admin');

	let escalas = $state<EscalaListagem[]>([]);
	let unidades = $state<Unidade[]>([]);
	let loading = $state(true);

	// Filtros
	let filtroTimeRange = $state<'24h' | '48h' | 'semana' | 'mes' | 'todos'>('todos');
	let filtroUnidade = $state('');
	let filtroData = $state('');
	let mostrarApenasNaoVistos = $state(false);

	const escalasFiltradas = $derived(
		escalas.filter((e) => {
			if (filtroUnidade && e.lotacao !== filtroUnidade) return false;
			if (filtroData && !e.data_inicio.includes(filtroData)) return false;
			if (mostrarApenasNaoVistos && e.visto_por_admin) return false;
			return true;
		})
	);

	async function carregar() {
		if (!isAdmin) return;
		loading = true;

		let params = new URLSearchParams();
		params.append('status', 'assinada');
		
		if (filtroTimeRange !== 'todos') {
			const agora = new Date();
			if (filtroTimeRange === '24h') agora.setHours(agora.getHours() - 24);
			else if (filtroTimeRange === '48h') agora.setHours(agora.getHours() - 48);
			else if (filtroTimeRange === 'semana') agora.setDate(agora.getDate() - 7);
			else if (filtroTimeRange === 'mes') agora.setMonth(agora.getMonth() - 1);
			
			// Format to SQLite compatible ISO-like string (YYYY-MM-DD HH:MM:SS)
			const iso = agora.toISOString().replace('T', ' ').split('.')[0];
			params.append('depois', iso);
		}

		const [resEscalas, resUnidades] = await Promise.all([
			fetch(`/api/escalas?${params.toString()}`),
			fetch('/api/unidades')
		]);

		if (resEscalas.ok) escalas = await resEscalas.json();
		if (resUnidades.ok) unidades = await resUnidades.json();
		
		loading = false;
	}

	async function toggleVisto(escala: EscalaListagem) {
		const novoStatus = !escala.visto_por_admin;
		const res = await fetch(`/api/escalas/${escala.id}/visto`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ visto: novoStatus })
		});

		if (res.ok) {
			escala.visto_por_admin = novoStatus ? 1 : 0;
			toaster.create({ 
				title: novoStatus ? 'Marcado como visto' : 'Marcado como não visto', 
				type: 'success' 
			});
		} else {
			toaster.create({ title: 'Erro ao atualizar status', type: 'error' });
		}
	}

	$effect(() => {
		if (isAdmin) carregar();
	});

	// Helper para formatar data de criação
	function formatRelativeTime(dateStr: string) {
		const date = new Date(dateStr.replace(' ', 'T'));
		return date.toLocaleString('pt-BR', { 
			day: '2-digit', month: '2-digit', 
			hour: '2-digit', minute: '2-digit' 
		});
	}
</script>

<svelte:head>
	<title>Escalas Recebidas | Admin</title>
</svelte:head>

{#if !isAdmin}
	<div class="text-center py-32 text-surface-500">
		<p class="text-2xl mb-2">🔒</p>
		<p>Acesso restrito a administradores.</p>
	</div>
{:else}
	<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
		<div>
			<h1 class="h1 text-xl font-bold">Escalas Recebidas</h1>
			<p class="text-sm text-surface-500 mt-0.5">Acompanhamento de novos envios em tempo real</p>
		</div>
		<button class="btn preset-outlined-surface btn-sm" onclick={carregar}>
			<svg class="w-4 h-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
			</svg>
			Atualizar
		</button>
	</div>

	<!-- Filtros Rápidos -->
	<div class="p-4 sm:p-5 mb-4 rounded-2xl bg-white/80 dark:bg-surface-900/60 backdrop-blur-md border border-surface-200 dark:border-white/5 shadow-xl shadow-black/5 dark:shadow-black/20 flex flex-col gap-4">
		
		<div class="flex flex-wrap gap-2 items-center">
			<span class="text-sm font-semibold text-surface-600 dark:text-surface-300 mr-1">Período de Recebimento:</span>
			{#each [['todos','Tudo'],['24h','Últimas 24h'],['48h','Últimas 48h'],['semana','Última Semana'],['mes','Último Mês']] as [val, label]}
				<button
					class="btn btn-sm {filtroTimeRange === val ? 'preset-filled-primary-500' : 'preset-outlined-surface'}"
					onclick={() => { filtroTimeRange = val as any; carregar(); }}
				>{label}</button>
			{/each}
		</div>

		<div class="flex flex-col sm:flex-row gap-3 items-end w-full">
			<label class="label flex-1">
				<span class="label-text text-sm font-semibold mb-1">Unidade</span>
				<select class="select" bind:value={filtroUnidade}>
					<option value="">Todas as unidades</option>
					{#each unidades as u (u.id)}
						<option value={u.nome}>{u.nome}</option>
					{/each}
				</select>
			</label>

			<label class="label flex-1">
				<span class="label-text text-sm font-semibold mb-1">Data da Escala</span>
				<input type="date" class="input" bind:value={filtroData} />
			</label>

			<label class="flex items-center gap-2 cursor-pointer pb-3 px-1">
				<input type="checkbox" class="checkbox" bind:checked={mostrarApenasNaoVistos} />
				<span class="text-sm font-medium">Não lidas</span>
			</label>
		</div>
	</div>

	<!-- Tabela de Recebidos -->
	<div class="rounded-3xl bg-white/80 dark:bg-surface-900/60 backdrop-blur-md border border-surface-200 dark:border-white/5 shadow-xl shadow-black/5 dark:shadow-black/20 p-4 sm:p-5">
		{#if loading}
			<p class="text-center py-16 text-surface-500">Carregando recebimentos...</p>
		{:else if escalasFiltradas.length === 0}
			<div class="text-center py-20 px-4">
				<p class="text-4xl mb-4">📥</p>
				<p class="text-surface-600 dark:text-surface-400 text-lg font-semibold">Nenhum recebimento encontrado</p>
				<p class="text-surface-500 text-sm mt-1">Tente ajustar os filtros acima para visualizar mais escalas.</p>
			</div>
		{:else}
			<div class="table-wrap overflow-hidden rounded-xl">
				<table class="table">
					<thead>
						<tr>
							<th class="w-10">Visto</th>
							<th>Unidade</th>
							<th>Título</th>
							<th>Tipo</th>
							<th>Recebido em</th>
							<th class="text-right">Ações</th>
						</tr>
					</thead>
					<tbody>
						{#each escalasFiltradas as escala (escala.id)}
							<tr class={escala.visto_por_admin ? 'opacity-60 grayscale-[0.5]' : 'bg-primary-500/5'}>
								<td>
									<input 
										type="checkbox" 
										class="checkbox" 
										checked={!!escala.visto_por_admin} 
										onchange={() => toggleVisto(escala)}
									/>
								</td>
								<td class="font-bold text-sm">{escala.lotacao}</td>
								<td class="max-w-[300px] truncate group relative">
									<span class="text-sm">{escala.titulo}</span>
								</td>
								<td>
									{#if escala.tipo === 'plantao'}
										<span class="badge preset-filled-tertiary-500/20 text-tertiary-900 dark:text-tertiary-200 border border-tertiary-500/30 text-[10px] font-bold">Plantão</span>
									{:else if escala.tipo === 'expediente'}
										<span class="badge preset-filled-primary-500/20 text-primary-900 dark:text-primary-200 border border-primary-500/30 text-[10px] font-bold">Expediente</span>
									{:else if escala.tipo === 'fds'}
										<span class="badge preset-filled-warning-500/20 text-warning-900 dark:text-warning-200 border border-warning-500/30 text-[10px] font-bold">FDS</span>
									{/if}
								</td>
								<td class="text-xs text-surface-500 whitespace-nowrap">
									{formatRelativeTime(escala.created_at)}
								</td>
								<td>
									<div class="flex gap-2 justify-end">
										<a href="/escalas/{escala.id}" class="btn btn-sm preset-outlined-primary-500 text-xs">Ver Detalhes</a>
										{#if escala.is_assinada}
											<span class="badge preset-filled-success-500 text-[10px] font-bold">Assinada</span>
										{/if}
									</div>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>

			<p class="pt-3 text-surface-500 text-xs border-t border-surface-200 dark:border-white/5 mt-1 px-1">
				Exibindo {escalasFiltradas.length} escala(s) recebida(s).
			</p>
		{/if}
	</div>
{/if}
