<script lang="ts">
	import { enhance } from '$app/forms';

	const { data, form } = $props();

	// ---- Rótulos e cores ----
	const SEVERIDADE: Record<string, { label: string; cls: string }> = {
		info: { label: 'Info', cls: 'bg-surface-300/40 text-surface-700 dark:text-surface-200' },
		aviso: { label: 'Aviso', cls: 'bg-warning-500/20 text-warning-700 dark:text-warning-300' },
		critico: { label: 'Crítico', cls: 'bg-error-500/20 text-error-700 dark:text-error-300' }
	};
	const RESULTADO: Record<string, { label: string; cls: string }> = {
		sucesso: { label: 'Sucesso', cls: 'text-success-700 dark:text-success-400' },
		falha: { label: 'Falha', cls: 'text-error-700 dark:text-error-400' },
		negado: { label: 'Negado', cls: 'text-warning-700 dark:text-warning-400' }
	};
	const CATEGORIA: Record<string, string> = {
		autenticacao: 'Autenticação',
		escala: 'Escala',
		gise: 'GISE',
		policial: 'Policial',
		unidade: 'Unidade',
		configuracao: 'Configuração',
		documento: 'Documento',
		lgpd: 'LGPD',
		sistema: 'Sistema'
	};
	const ACTOR: Record<string, string> = {
		policial: 'Policial',
		admin: 'Admin',
		sistema: 'Sistema',
		webhook: 'Webhook'
	};

	const acaoLabel = $derived(
		new Map<string, string>(data.facetas.acoes.map((a) => [a.valor, a.label]))
	);
	function rotuloAcao(a: string): string {
		return acaoLabel.get(a) ?? a;
	}

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
	/** Campos alterados entre dois snapshots, para o diff. */
	function diff(antes: string | null, depois: string | null) {
		const a = parseJson(antes) ?? {};
		const b = parseJson(depois) ?? {};
		const chaves = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
		return chaves
			.map((k) => ({ campo: k, de: a[k], para: b[k] }))
			.filter((r) => JSON.stringify(r.de) !== JSON.stringify(r.para));
	}
	function val(v: unknown): string {
		if (v === null || v === undefined || v === '') return '∅';
		if (typeof v === 'object') return JSON.stringify(v);
		return String(v);
	}

	// ---- Query string para paginação / export preservando filtros ----
	function queryString(extra: Record<string, string | number | undefined> = {}): string {
		const f = data.filtros;
		const campos: Record<string, string | number | undefined> = {
			categoria: f.categoria,
			acao: f.acao,
			severidade: f.severidade,
			resultado: f.resultado,
			actor_tipo: f.actor_tipo,
			busca: f.busca,
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
	let verificando = $state(false);
	const integridade = $derived(form?.integridade);

	const filtrosAtivos = $derived(
		[
			data.filtros.categoria,
			data.filtros.acao,
			data.filtros.severidade,
			data.filtros.resultado,
			data.filtros.actor_tipo,
			data.filtros.busca,
			data.filtros.de,
			data.filtros.ate
		].filter(Boolean).length
	);
</script>

<svelte:head><title>Auditoria — Escalas PC</title></svelte:head>

<div class="max-w-7xl mx-auto p-4 sm:p-6 space-y-6">
	<header class="flex flex-wrap items-center justify-between gap-3">
		<div>
			<h1 class="text-2xl font-bold text-surface-900 dark:text-white">Trilha de Auditoria</h1>
			<p class="text-sm text-surface-500 dark:text-surface-400">
				Registro forense de ações do sistema — cadeia de hash verificável.
			</p>
		</div>
		<div class="flex items-center gap-2">
			<a
				href="/auditoria/export?{queryString()}"
				class="btn preset-outlined-surface-500 text-sm"
				data-sveltekit-reload
				data-sveltekit-preload-data="off"
			>
				Exportar CSV
			</a>
			<form
				method="POST"
				action="?/verificar"
				use:enhance={() => {
					verificando = true;
					return async ({ update }) => {
						await update({ reset: false });
						verificando = false;
					};
				}}
			>
				<button type="submit" class="btn preset-filled-primary-500 text-sm" disabled={verificando}>
					{verificando ? 'Verificando…' : 'Verificar integridade'}
				</button>
			</form>
		</div>
	</header>

	{#if integridade}
		<div
			class="rounded-xl border p-4 text-sm {integridade.ok
				? 'border-success-500/30 bg-success-500/10 text-success-800 dark:text-success-300'
				: 'border-error-500/30 bg-error-500/10 text-error-800 dark:text-error-300'}"
		>
			{#if integridade.ok}
				<p>
					✓ Cadeia íntegra — {integridade.verificados} registro(s) encadeado(s) verificado(s) sem adulteração.
				</p>
				{#if integridade.ultimoHash}
					<p class="mt-1 text-xs font-mono break-all opacity-80">
						Âncora atual: seq {integridade.ultimoSeq} · {integridade.ultimoHash}
					</p>
					<p class="mt-1 text-xs opacity-70">
						Registre esta âncora externamente — se o log for adulterado depois, este valor não bate
						mais.
					</p>
				{/if}
			{:else}
				⚠ Inconsistência detectada{integridade.primeiroProblemaSeq
					? ` (seq ${integridade.primeiroProblemaSeq})`
					: ''}: {integridade.problema}
			{/if}
		</div>
	{/if}

	<!-- KPIs -->
	<div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
		{#snippet kpi(rotulo: string, valor: string | number, destaque = false)}
			<div
				class="rounded-xl border border-surface-200 dark:border-white/10 bg-surface-50 dark:bg-surface-900 p-4"
			>
				<div class="text-xs uppercase tracking-wide text-surface-500 dark:text-surface-400">
					{rotulo}
				</div>
				<div
					class="mt-1 text-2xl font-bold {destaque && Number(valor) > 0
						? 'text-error-600 dark:text-error-400'
						: 'text-surface-900 dark:text-white'}"
				>
					{valor}
				</div>
			</div>
		{/snippet}
		{@render kpi('Total de eventos', data.resumo.total.toLocaleString('pt-BR'))}
		{@render kpi('Falhas de login (24h)', data.resumo.falhasLogin24h, true)}
		{@render kpi('Eventos críticos (7d)', data.resumo.criticos7d, true)}
		{@render kpi('Último evento', fmtData(data.resumo.ultimoEvento))}
	</div>

	<!-- Destaques de segurança -->
	{#if data.criticosRecentes.length > 0}
		<div class="rounded-xl border border-error-500/30 bg-error-500/5 p-4">
			<div
				class="text-xs font-semibold uppercase tracking-wide text-error-700 dark:text-error-400 mb-2"
			>
				Destaques de segurança · eventos críticos recentes
			</div>
			<ul class="space-y-1 text-sm">
				{#each data.criticosRecentes as ev (ev.id)}
					<li class="flex flex-wrap items-baseline gap-x-2">
						<span class="text-surface-400 text-xs whitespace-nowrap">{fmtData(ev.created_at)}</span>
						<span class="font-medium text-surface-900 dark:text-white">{rotuloAcao(ev.acao)}</span>
						<span class="text-surface-600 dark:text-surface-300">— {ev.usuario_nome || '—'}</span>
						{#if ev.detalhes}
							<span class="text-surface-500 dark:text-surface-400 text-xs">· {ev.detalhes}</span>
						{/if}
					</li>
				{/each}
			</ul>
		</div>
	{/if}

	<!-- Filtros (GET → URL) -->
	<form
		method="GET"
		class="rounded-xl border border-surface-200 dark:border-white/10 bg-surface-50 dark:bg-surface-900 p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3"
	>
		<label class="flex flex-col gap-1 text-sm">
			<span class="text-surface-500 dark:text-surface-400">Categoria</span>
			<select name="categoria" class="select">
				<option value="" selected={!data.filtros.categoria}>Todas</option>
				{#each data.facetas.categorias as c (c)}
					<option value={c} selected={data.filtros.categoria === c}>{CATEGORIA[c] ?? c}</option>
				{/each}
			</select>
		</label>
		<label class="flex flex-col gap-1 text-sm">
			<span class="text-surface-500 dark:text-surface-400">Ação</span>
			<select name="acao" class="select">
				<option value="" selected={!data.filtros.acao}>Todas</option>
				{#each data.facetas.acoes as a (a.valor)}
					<option value={a.valor} selected={data.filtros.acao === a.valor}>{a.label}</option>
				{/each}
			</select>
		</label>
		<label class="flex flex-col gap-1 text-sm">
			<span class="text-surface-500 dark:text-surface-400">Severidade</span>
			<select name="severidade" class="select">
				<option value="" selected={!data.filtros.severidade}>Todas</option>
				<option value="info" selected={data.filtros.severidade === 'info'}>Info</option>
				<option value="aviso" selected={data.filtros.severidade === 'aviso'}>Aviso</option>
				<option value="critico" selected={data.filtros.severidade === 'critico'}>Crítico</option>
			</select>
		</label>
		<label class="flex flex-col gap-1 text-sm">
			<span class="text-surface-500 dark:text-surface-400">Resultado</span>
			<select name="resultado" class="select">
				<option value="" selected={!data.filtros.resultado}>Todos</option>
				<option value="sucesso" selected={data.filtros.resultado === 'sucesso'}>Sucesso</option>
				<option value="falha" selected={data.filtros.resultado === 'falha'}>Falha</option>
				<option value="negado" selected={data.filtros.resultado === 'negado'}>Negado</option>
			</select>
		</label>
		<label class="flex flex-col gap-1 text-sm">
			<span class="text-surface-500 dark:text-surface-400">Busca (ator / detalhes / alvo)</span>
			<input
				name="busca"
				class="input"
				value={data.filtros.busca ?? ''}
				placeholder="texto livre"
			/>
		</label>
		<label class="flex flex-col gap-1 text-sm">
			<span class="text-surface-500 dark:text-surface-400">De</span>
			<input type="date" name="de" class="input" value={data.filtros.de ?? ''} />
		</label>
		<label class="flex flex-col gap-1 text-sm">
			<span class="text-surface-500 dark:text-surface-400">Até</span>
			<input type="date" name="ate" class="input" value={data.filtros.ate ?? ''} />
		</label>
		<div class="flex items-end gap-2">
			<button type="submit" class="btn preset-filled-primary-500 text-sm">Filtrar</button>
			{#if filtrosAtivos > 0}
				<a href="/auditoria" class="btn preset-outlined-surface-500 text-sm"
					>Limpar ({filtrosAtivos})</a
				>
			{/if}
		</div>
	</form>

	<div class="flex justify-end -mb-2 text-sm text-surface-500 dark:text-surface-400">
		{data.total.toLocaleString('pt-BR')} resultado(s)
	</div>

	<!-- Tabela -->
	<div
		class="rounded-xl border border-surface-200 dark:border-white/10 overflow-x-auto bg-surface-50 dark:bg-surface-900"
	>
		<table class="w-full text-sm">
			<thead
				class="text-left text-xs uppercase tracking-wide text-surface-500 dark:text-surface-400 border-b border-surface-200 dark:border-white/10"
			>
				<tr>
					<th class="px-3 py-2">Data/hora</th>
					<th class="px-3 py-2">Severidade</th>
					<th class="px-3 py-2">Categoria</th>
					<th class="px-3 py-2">Ação</th>
					<th class="px-3 py-2">Ator</th>
					<th class="px-3 py-2">Alvo</th>
					<th class="px-3 py-2">Resultado</th>
				</tr>
			</thead>
			<tbody>
				{#each data.logs as log (log.id)}
					{@const sev = SEVERIDADE[log.severidade ?? 'info'] ?? SEVERIDADE.info}
					{@const res = RESULTADO[log.resultado ?? 'sucesso'] ?? RESULTADO.sucesso}
					{@const mudancas = diff(log.dados_antes, log.dados_depois)}
					<tr
						class="border-b border-surface-200/60 dark:border-white/5 hover:bg-surface-100/60 dark:hover:bg-surface-800/40 cursor-pointer"
						onclick={() => (expandido = expandido === log.id ? null : log.id)}
					>
						<td class="px-3 py-2 whitespace-nowrap text-surface-700 dark:text-surface-200">
							{fmtData(log.created_at)}
						</td>
						<td class="px-3 py-2">
							<span class="inline-block px-2 py-0.5 rounded-full text-xs font-medium {sev.cls}">
								{sev.label}
							</span>
						</td>
						<td class="px-3 py-2 text-surface-600 dark:text-surface-300">
							{CATEGORIA[log.categoria ?? ''] ?? log.categoria ?? '—'}
						</td>
						<td class="px-3 py-2 font-medium text-surface-900 dark:text-white">
							{rotuloAcao(log.acao)}
						</td>
						<td class="px-3 py-2 text-surface-700 dark:text-surface-200">
							{log.usuario_nome || '—'}
							<span class="text-xs text-surface-400">
								{log.actor_tipo ? `· ${ACTOR[log.actor_tipo] ?? log.actor_tipo}` : ''}
							</span>
						</td>
						<td class="px-3 py-2 text-surface-600 dark:text-surface-300">
							{log.alvo_nome ?? (log.alvo_id ? `#${log.alvo_id}` : '—')}
						</td>
						<td class="px-3 py-2 font-medium {res.cls}">{res.label}</td>
					</tr>
					{#if expandido === log.id}
						<tr class="bg-surface-100/50 dark:bg-surface-800/30">
							<td colspan="7" class="px-4 py-3">
								<div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
									<div class="space-y-1">
										{#if log.detalhes}
											<p class="text-surface-800 dark:text-surface-100">{log.detalhes}</p>
										{/if}
										<dl
											class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-surface-600 dark:text-surface-300"
										>
											<dt class="font-medium">Entidade</dt>
											<dd>{log.entidade}{log.entidade_id ? ` #${log.entidade_id}` : ''}</dd>
											<dt class="font-medium">IP</dt>
											<dd>{log.ip ?? '—'}{log.ip_cifrado ? ' (completo cifrado)' : ''}</dd>
											<dt class="font-medium">Rota</dt>
											<dd>{log.metodo ?? ''} {log.rota ?? '—'}</dd>
											<dt class="font-medium">Request ID</dt>
											<dd class="font-mono">{log.request_id ?? '—'}</dd>
											<dt class="font-medium">Seq / Hash</dt>
											<dd class="font-mono break-all">
												{log.seq ?? '—'} · {log.hash_registro?.slice(0, 18) ?? '—'}…
											</dd>
											{#if log.user_agent}
												<dt class="font-medium">User-Agent</dt>
												<dd class="break-all">{log.user_agent}</dd>
											{/if}
										</dl>
									</div>
									<div class="space-y-2">
										{#if mudancas.length > 0}
											<div>
												<div
													class="text-xs font-semibold text-surface-500 dark:text-surface-400 mb-1"
												>
													Alterações
												</div>
												<table
													class="w-full text-xs border border-surface-200 dark:border-white/10 rounded"
												>
													<thead class="text-surface-500 dark:text-surface-400">
														<tr>
															<th class="px-2 py-1 text-left">Campo</th>
															<th class="px-2 py-1 text-left">De</th>
															<th class="px-2 py-1 text-left">Para</th>
														</tr>
													</thead>
													<tbody>
														{#each mudancas as m (m.campo)}
															<tr class="border-t border-surface-200/60 dark:border-white/5">
																<td class="px-2 py-1 font-medium">{m.campo}</td>
																<td class="px-2 py-1 text-error-600 dark:text-error-400"
																	>{val(m.de)}</td
																>
																<td class="px-2 py-1 text-success-700 dark:text-success-400"
																	>{val(m.para)}</td
																>
															</tr>
														{/each}
													</tbody>
												</table>
											</div>
										{/if}
										{#if parseJson(log.metadados)}
											<div>
												<div
													class="text-xs font-semibold text-surface-500 dark:text-surface-400 mb-1"
												>
													Metadados
												</div>
												<pre
													class="text-xs bg-surface-200/50 dark:bg-surface-950/50 rounded p-2 overflow-x-auto">{JSON.stringify(
														parseJson(log.metadados),
														null,
														2
													)}</pre>
											</div>
										{/if}
									</div>
								</div>
							</td>
						</tr>
					{/if}
				{:else}
					<tr>
						<td colspan="7" class="px-4 py-10 text-center text-surface-500 dark:text-surface-400">
							Nenhum evento encontrado para os filtros atuais.
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>

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
