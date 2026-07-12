<script lang="ts">
	import { ChevronDown, ChevronUp, ArrowLeft } from 'lucide-svelte';
	import { onMount } from 'svelte';

	const { data } = $props();

	// ---- Rótulos e cores ----
	const NIVEL: Record<string, { label: string; cls: string }> = {
		warn: { label: 'Aviso', cls: 'bg-warning-500/20 text-warning-700 dark:text-warning-300' },
		error: { label: 'Erro', cls: 'bg-error-500/20 text-error-700 dark:text-error-300' }
	};

	// ---- Formatação ----
	function fmtData(s: string | null): string {
		if (!s) return '—';
		const d = new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
		return Number.isNaN(d.getTime()) ? s : d.toLocaleString('pt-BR');
	}
	function parseJson(s: string | null): Record<string, unknown> | null {
		if (!s) return null;
		try {
			return JSON.parse(s) as Record<string, unknown>;
		} catch {
			return null;
		}
	}

	// ---- Query string para paginação preservando filtros ----
	function queryString(extra: Record<string, string | number | undefined> = {}): string {
		const f = data.filtros;
		const campos: Record<string, string | number | undefined> = {
			level: f.level,
			busca: f.busca,
			request_id: f.request_id,
			de: f.de,
			ate: f.ate,
			...extra
		};
		return Object.entries(campos)
			.filter(([, v]) => v !== undefined && v !== '' && v !== null)
			.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
			.join('&');
	}

	let expandido = $state<number | null>(null);

	const filtrosAtivos = $derived(
		[
			data.filtros.level,
			data.filtros.busca,
			data.filtros.request_id,
			data.filtros.de,
			data.filtros.ate
		].filter(Boolean).length
	);

	let filtrosExpandidos = $state(false);

	onMount(() => {
		if (filtrosAtivos > 0) {
			filtrosExpandidos = true;
		}
	});
</script>

<svelte:head><title>Logs técnicos — Escalas PC</title></svelte:head>

<div class="max-w-7xl mx-auto p-4 sm:p-6 space-y-6">
	<header class="flex flex-wrap items-center justify-between gap-3">
		<div>
			<a
				href="/auditoria"
				class="inline-flex items-center gap-1 text-xs text-primary-600 dark:text-primary-400 hover:underline mb-1"
			>
				<ArrowLeft class="w-3.5 h-3.5" />
				Trilha de Auditoria
			</a>
			<h1 class="text-2xl font-bold text-surface-900 dark:text-white">Logs técnicos</h1>
			<p class="text-sm text-surface-500 dark:text-surface-400">
				Avisos e erros do servidor, correlacionáveis com a auditoria pelo Request ID. O mesmo
				Request ID é o "código do erro" exibido ao usuário em falhas internas.
			</p>
		</div>
	</header>

	<!-- KPIs -->
	<div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
		{#snippet kpi(rotulo: string, valor: string | number, destaque = false)}
			<div
				class="rounded-xl border border-surface-200 dark:border-white/10 bg-surface-50 dark:bg-surface-900 p-4 flex flex-col justify-between min-h-[90px]"
			>
				<div class="text-xs uppercase tracking-wide text-surface-500 dark:text-surface-400">
					{rotulo}
				</div>
				<div
					class="mt-1 text-lg sm:text-2xl font-bold truncate {destaque && Number(valor) > 0
						? 'text-error-600 dark:text-error-400'
						: 'text-surface-900 dark:text-white'}"
					title={String(valor)}
				>
					{valor}
				</div>
			</div>
		{/snippet}
		{@render kpi('Total de registros', data.resumo.total.toLocaleString('pt-BR'))}
		{@render kpi('Erros (24h)', data.resumo.erros24h, true)}
		{@render kpi('Avisos (24h)', data.resumo.avisos24h)}
		{@render kpi('Último registro', fmtData(data.resumo.ultimoRegistro))}
	</div>

	<!-- Filtros (GET → URL) -->
	<div
		class="rounded-xl border border-surface-200 dark:border-white/10 bg-surface-50 dark:bg-surface-900 p-4 space-y-4"
	>
		<div class="flex items-center justify-between">
			<div class="flex items-center gap-2">
				<span class="font-semibold text-surface-900 dark:text-white">Filtros</span>
				{#if filtrosAtivos > 0}
					<span class="badge preset-filled-primary-500 text-xs">
						{filtrosAtivos}
						{filtrosAtivos === 1 ? 'ativo' : 'ativos'}
					</span>
				{/if}
			</div>
			<button
				type="button"
				onclick={() => (filtrosExpandidos = !filtrosExpandidos)}
				class="btn btn-sm preset-outlined-surface-500 lg:hidden flex items-center gap-1 text-xs py-1 px-2.5"
			>
				{#if filtrosExpandidos}
					Ocultar Filtros
					<ChevronUp class="w-3.5 h-3.5" />
				{:else}
					Mostrar Filtros
					<ChevronDown class="w-3.5 h-3.5" />
				{/if}
			</button>
		</div>

		<form
			method="GET"
			class="{filtrosExpandidos
				? 'grid'
				: 'hidden lg:grid'} grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3"
		>
			<label class="flex flex-col gap-1 text-sm">
				<span class="text-surface-500 dark:text-surface-400">Nível</span>
				<select name="level" class="select">
					<option value="" selected={!data.filtros.level}>Todos</option>
					<option value="warn" selected={data.filtros.level === 'warn'}>Aviso</option>
					<option value="error" selected={data.filtros.level === 'error'}>Erro</option>
				</select>
			</label>
			<label class="flex flex-col gap-1 text-sm">
				<span class="text-surface-500 dark:text-surface-400"
					>Busca (mensagem / contexto / rota)</span
				>
				<input
					name="busca"
					class="input"
					value={data.filtros.busca ?? ''}
					placeholder="texto livre"
				/>
			</label>
			<label class="flex flex-col gap-1 text-sm">
				<span class="text-surface-500 dark:text-surface-400">Request ID</span>
				<input
					name="request_id"
					class="input font-mono"
					value={data.filtros.request_id ?? ''}
					placeholder="ex.: 3fa1b2c4"
				/>
			</label>
			<div class="grid grid-cols-2 gap-3">
				<label class="flex flex-col gap-1 text-sm">
					<span class="text-surface-500 dark:text-surface-400">De</span>
					<input type="date" name="de" class="input" value={data.filtros.de ?? ''} />
				</label>
				<label class="flex flex-col gap-1 text-sm">
					<span class="text-surface-500 dark:text-surface-400">Até</span>
					<input type="date" name="ate" class="input" value={data.filtros.ate ?? ''} />
				</label>
			</div>
			<div class="flex items-end gap-2 pt-2 lg:pt-0 col-span-1 sm:col-span-2 lg:col-span-4">
				<button
					type="submit"
					class="btn preset-filled-primary-500 text-sm flex-1 sm:flex-none justify-center"
				>
					Filtrar
				</button>
				{#if filtrosAtivos > 0}
					<a
						href="/auditoria/logs"
						class="btn preset-outlined-surface-500 text-sm flex-1 sm:flex-none justify-center"
					>
						Limpar
					</a>
				{/if}
			</div>
		</form>
	</div>

	<div class="flex justify-end -mb-2 text-sm text-surface-500 dark:text-surface-400">
		{data.total.toLocaleString('pt-BR')} resultado(s)
	</div>

	{#if data.logs.length > 0}
		<!-- Tabela (Desktop) -->
		<div
			class="hidden md:block rounded-xl border border-surface-200 dark:border-white/10 overflow-x-auto bg-surface-50 dark:bg-surface-900"
		>
			<table class="w-full text-sm">
				<thead
					class="text-left text-xs uppercase tracking-wide text-surface-500 dark:text-surface-400 border-b border-surface-200 dark:border-white/10"
				>
					<tr>
						<th class="px-3 py-2">Data/hora</th>
						<th class="px-3 py-2">Nível</th>
						<th class="px-3 py-2">Mensagem</th>
						<th class="px-3 py-2">Rota</th>
						<th class="px-3 py-2">Request ID</th>
					</tr>
				</thead>
				<tbody>
					{#each data.logs as log (log.id)}
						{@const niv = NIVEL[log.level] ?? NIVEL.warn}
						{@const ctx = parseJson(log.contexto)}
						<tr
							class="border-b border-surface-200/60 dark:border-white/5 hover:bg-surface-100/60 dark:hover:bg-surface-800/40 cursor-pointer"
							onclick={() => (expandido = expandido === log.id ? null : log.id)}
						>
							<td class="px-3 py-2 whitespace-nowrap text-surface-700 dark:text-surface-200">
								{fmtData(log.created_at)}
							</td>
							<td class="px-3 py-2">
								<span class="inline-block px-2 py-0.5 rounded-full text-xs font-medium {niv.cls}">
									{niv.label}
								</span>
							</td>
							<td class="px-3 py-2 font-medium text-surface-900 dark:text-white max-w-md truncate">
								{log.message}
							</td>
							<td
								class="px-3 py-2 text-surface-600 dark:text-surface-300 max-w-[200px] truncate font-mono text-xs"
							>
								{log.rota ?? '—'}
							</td>
							<td class="px-3 py-2 font-mono text-xs text-surface-600 dark:text-surface-300">
								{log.request_id ?? '—'}
							</td>
						</tr>
						{#if expandido === log.id}
							<tr class="bg-surface-100/50 dark:bg-surface-800/30">
								<td colspan="5" class="px-4 py-3">
									<div class="space-y-3 text-sm">
										<p class="text-surface-800 dark:text-surface-100 break-words">{log.message}</p>
										<dl
											class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-surface-600 dark:text-surface-300"
										>
											<dt class="font-medium">Rota</dt>
											<dd class="font-mono">{log.rota ?? '—'}</dd>
											<dt class="font-medium">Request ID</dt>
											<dd class="font-mono">{log.request_id ?? '—'}</dd>
											<dt class="font-medium">Usuário (id)</dt>
											<dd>{log.usuario_id ?? 'anônimo'}</dd>
										</dl>
										{#if ctx}
											<div>
												<div
													class="text-xs font-semibold text-surface-500 dark:text-surface-400 mb-1"
												>
													Contexto
												</div>
												<pre
													class="text-xs bg-surface-200/50 dark:bg-surface-950/50 rounded p-2 overflow-x-auto">{JSON.stringify(
														ctx,
														null,
														2
													)}</pre>
											</div>
										{:else if log.contexto}
											<div>
												<div
													class="text-xs font-semibold text-surface-500 dark:text-surface-400 mb-1"
												>
													Contexto (truncado)
												</div>
												<pre
													class="text-xs bg-surface-200/50 dark:bg-surface-950/50 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">{log.contexto}</pre>
											</div>
										{/if}
									</div>
								</td>
							</tr>
						{/if}
					{/each}
				</tbody>
			</table>
		</div>

		<!-- Lista de Cards (Mobile) -->
		<div class="block md:hidden space-y-3">
			{#each data.logs as log (log.id)}
				{@const niv = NIVEL[log.level] ?? NIVEL.warn}
				{@const ctx = parseJson(log.contexto)}

				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					class="rounded-xl border border-surface-200 dark:border-white/10 bg-surface-50 dark:bg-surface-900 p-4 space-y-3 cursor-pointer transition-colors active:bg-surface-100 dark:active:bg-surface-800/40"
					onclick={() => (expandido = expandido === log.id ? null : log.id)}
				>
					<div class="flex items-center justify-between gap-2">
						<span class="inline-block px-2 py-0.5 rounded-full text-xs font-semibold {niv.cls}">
							{niv.label}
						</span>
						<span class="text-xs text-surface-500 dark:text-surface-400"
							>{fmtData(log.created_at)}</span
						>
					</div>

					<h3 class="text-sm font-semibold text-surface-900 dark:text-white break-words">
						{log.message}
					</h3>

					<div
						class="flex items-center justify-between border-t border-surface-200/50 dark:border-white/5 pt-2 text-xs text-surface-500 dark:text-surface-400"
					>
						<span class="font-mono truncate max-w-[60%]">{log.rota ?? '—'}</span>
						<span class="flex items-center gap-0.5 text-primary-500 font-medium">
							{expandido === log.id ? 'Recolher' : 'Detalhes'}
							{#if expandido === log.id}
								<ChevronUp class="w-3.5 h-3.5" />
							{:else}
								<ChevronDown class="w-3.5 h-3.5" />
							{/if}
						</span>
					</div>

					{#if expandido === log.id}
						<!-- svelte-ignore a11y_click_events_have_key_events -->
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<div
							class="border-t border-surface-200/60 dark:border-white/10 pt-3 space-y-3 text-xs"
							onclick={(e) => e.stopPropagation()}
						>
							<div class="bg-surface-100/50 dark:bg-surface-800/40 rounded-lg p-3">
								<dl
									class="grid grid-cols-[90px_1fr] gap-x-2 gap-y-1.5 text-surface-600 dark:text-surface-300"
								>
									<dt class="font-semibold text-surface-500 dark:text-surface-400">Rota</dt>
									<dd class="font-mono break-all text-surface-800 dark:text-surface-200">
										{log.rota ?? '—'}
									</dd>
									<dt class="font-semibold text-surface-500 dark:text-surface-400">Request ID</dt>
									<dd class="font-mono text-surface-800 dark:text-surface-200">
										{log.request_id ?? '—'}
									</dd>
									<dt class="font-semibold text-surface-500 dark:text-surface-400">Usuário (id)</dt>
									<dd class="text-surface-800 dark:text-surface-200">
										{log.usuario_id ?? 'anônimo'}
									</dd>
								</dl>
							</div>
							{#if ctx}
								<div class="space-y-1">
									<div class="font-semibold text-surface-500 dark:text-surface-400">Contexto</div>
									<pre
										class="text-xs bg-surface-200/50 dark:bg-surface-950/50 rounded-lg p-2.5 overflow-x-auto text-surface-800 dark:text-surface-200 font-mono">{JSON.stringify(
											ctx,
											null,
											2
										)}</pre>
								</div>
							{:else if log.contexto}
								<div class="space-y-1">
									<div class="font-semibold text-surface-500 dark:text-surface-400">
										Contexto (truncado)
									</div>
									<pre
										class="text-xs bg-surface-200/50 dark:bg-surface-950/50 rounded-lg p-2.5 overflow-x-auto whitespace-pre-wrap break-all text-surface-800 dark:text-surface-200 font-mono">{log.contexto}</pre>
								</div>
							{/if}
						</div>
					{/if}
				</div>
			{/each}
		</div>
	{:else}
		<div
			class="rounded-xl border border-surface-200 dark:border-white/10 p-10 text-center bg-surface-50 dark:bg-surface-900 text-surface-500 dark:text-surface-400 text-sm"
		>
			Nenhum log encontrado para os filtros atuais.
		</div>
	{/if}

	<!-- Paginação -->
	{#if data.totalPages > 1}
		<div class="flex items-center justify-center gap-2">
			{#if data.page > 1}
				<a
					href="?{queryString({ page: data.page - 1 })}"
					class="btn preset-outlined-surface-500 text-sm"
				>
					Anterior
				</a>
			{/if}
			<span class="text-sm text-surface-500 dark:text-surface-400">
				Página {data.page} de {data.totalPages}
			</span>
			{#if data.page < data.totalPages}
				<a
					href="?{queryString({ page: data.page + 1 })}"
					class="btn preset-outlined-surface-500 text-sm"
				>
					Próxima
				</a>
			{/if}
		</div>
	{/if}
</div>
