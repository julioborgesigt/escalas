<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { toaster } from '$lib/toast';

	let { data } = $props();

	const gise = $derived(data.gise);
	const policiais = $derived(data.policiais ?? []);
	const todasUnidades = $derived(data.todasUnidades ?? []);
	const papelGise = $derived(data.papelGise);
	const minhaSeccionalId = $derived(data.minhaSeccionalId);

	const isAdminGeral = $derived(papelGise === 'admin_geral');
	const isSeccional = $derived(papelGise === 'admin_seccional');
	const isSupervisor = $derived(papelGise === 'supervisor');

	// Minha seccional (para Admin Seccional)
	const minhaSeccional = $derived(
		isSeccional ? gise?.seccionais?.find((s: any) => s.seccional_id === minhaSeccionalId) : null
	);

	// Estado de UI
	let salvando = $state(false);
	let assinando = $state(false);
	let finalizando = $state(false);
	let showFinalizarConfirm = $state(false);
	let showAssinaConfirm = $state(false);

	// Edição de supervisores (Admin Geral / Admin Seccional)
	let editandoSupervisores = $state(false);
	let supSabadoId = $state<number | null>(null);
	let supDomingoId = $state<number | null>(null);

	// Equipe selecionada para adicionar membro
	let equipeParaAdicionar = $state<number | null>(null);
	let policialParaAdicionar = $state<number | ''>('');
	let diaParaAdicionar = $state<'sabado' | 'domingo' | 'ambos'>('ambos');

	// Unidade operacional (Admin Seccional)
	let unidadeOperacionalId = $state<number | null>(null);

	$effect(() => {
		if (gise) {
			supSabadoId = gise.supervisor_sabado_id ?? null;
			supDomingoId = gise.supervisor_domingo_id ?? null;
			if (minhaSeccional) {
				unidadeOperacionalId = minhaSeccional.unidade_operacional_id ?? null;
			}
		}
	});

	function statusLabel(status: string) {
		const m: Record<string, string> = {
			em_preenchimento: 'Em Preenchimento',
			aguardando_assinatura: 'Aguardando Assinatura',
			assinada: 'Assinada',
			finalizada: 'Finalizada'
		};
		return m[status] ?? status;
	}
	function statusColor(status: string) {
		const m: Record<string, string> = {
			em_preenchimento: 'bg-warning-500/15 text-warning-700 dark:text-warning-400',
			aguardando_assinatura: 'bg-primary-500/15 text-primary-700 dark:text-primary-400',
			assinada: 'bg-success-500/15 text-success-700 dark:text-success-400',
			finalizada: 'bg-surface-500/15 text-surface-600 dark:text-surface-400'
		};
		return m[status] ?? '';
	}
	function fmtDate(iso: string) {
		const [y, m, d] = iso.split('-');
		return `${d}/${m}/${y}`;
	}

	const dpcs = $derived(policiais.filter((p: any) => p.cargo === 'DPC'));

	async function salvarSupervisores() {
		salvando = true;
		try {
			const res = await fetch(`/api/gise/${gise.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					supervisor_sabado_id: supSabadoId,
					supervisor_domingo_id: supDomingoId
				})
			});
			const json = await res.json();
			if (!res.ok) throw new Error(json.error);
			toaster.success({ title: 'Supervisores salvos' });
			editandoSupervisores = false;
			await invalidateAll();
		} catch (e: any) {
			toaster.error({ title: 'Erro', description: e.message });
		} finally {
			salvando = false;
		}
	}

	async function salvarUnidadeOperacional(secId: number) {
		salvando = true;
		try {
			const res = await fetch(`/api/gise/${gise.id}/seccionais/${secId}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ unidade_operacional_id: unidadeOperacionalId })
			});
			const json = await res.json();
			if (!res.ok) throw new Error(json.error);
			toaster.success({ title: 'Unidade operacional salva' });
			await invalidateAll();
		} catch (e: any) {
			toaster.error({ title: 'Erro', description: e.message });
		} finally {
			salvando = false;
		}
	}

	async function adicionarMembro(secId: number) {
		if (!equipeParaAdicionar || !policialParaAdicionar) return;
		salvando = true;
		try {
			const res = await fetch(`/api/gise/${gise.id}/seccionais/${secId}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					adicionar_membro: {
						equipe_id: equipeParaAdicionar,
						policial_id: Number(policialParaAdicionar),
						dia: diaParaAdicionar
					}
				})
			});
			const json = await res.json();
			if (!res.ok) throw new Error(json.error);
			toaster.success({ title: 'Membro adicionado' });
			equipeParaAdicionar = null;
			policialParaAdicionar = '';
			await invalidateAll();
		} catch (e: any) {
			toaster.error({ title: 'Erro', description: e.message });
		} finally {
			salvando = false;
		}
	}

	async function removerMembro(memId: number) {
		try {
			const res = await fetch(`/api/gise/${gise.id}/membros/${memId}`, { method: 'DELETE' });
			const json = await res.json();
			if (!res.ok) throw new Error(json.error);
			await invalidateAll();
		} catch (e: any) {
			toaster.error({ title: 'Erro', description: e.message });
		}
	}

	async function finalizarSeccional(secId: number) {
		salvando = true;
		try {
			const res = await fetch(`/api/gise/${gise.id}/seccionais/${secId}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: '{}'
			});
			const json = await res.json();
			if (!res.ok) throw new Error(json.error);
			if (json.gise_status === 'aguardando_assinatura') {
				toaster.success({ title: 'Todas as seccionais finalizadas!', description: 'Escala aguardando assinatura do Supervisor.' });
			} else {
				toaster.success({ title: 'Seccional finalizada', description: 'Aguardando demais seccionais.' });
			}
			await invalidateAll();
		} catch (e: any) {
			toaster.error({ title: 'Erro', description: e.message });
		} finally {
			salvando = false;
		}
	}

	async function assinarEscala() {
		assinando = true;
		try {
			const res = await fetch(`/api/gise/${gise.id}/assinar`, { method: 'POST' });
			const json = await res.json();
			if (!res.ok) throw new Error(json.error);
			toaster.success({ title: 'Escala assinada!', description: `Hash: ${json.verificacao_hash?.slice(0, 12)}...` });
			showAssinaConfirm = false;
			await invalidateAll();
		} catch (e: any) {
			toaster.error({ title: 'Erro', description: e.message });
		} finally {
			assinando = false;
		}
	}

	async function finalizarGise() {
		finalizando = true;
		try {
			const res = await fetch(`/api/gise/${gise.id}/finalizar`, { method: 'POST' });
			const json = await res.json();
			if (!res.ok) throw new Error(json.error);
			toaster.success({ title: 'Escala finalizada!', description: `Nova escala criada (ID ${json.nova_gise_id})` });
			showFinalizarConfirm = false;
			goto(`/gise/${json.nova_gise_id}`);
		} catch (e: any) {
			toaster.error({ title: 'Erro', description: e.message });
		} finally {
			finalizando = false;
		}
	}

	const podeFinalizar = $derived(isAdminGeral && gise?.status === 'assinada');
	const podeAssinar = $derived(isSupervisor && gise?.status === 'aguardando_assinatura');
	const podeEditar = $derived(
		gise?.status !== 'finalizada' && gise?.status !== 'assinada'
	);

	// Filtra delegacias (unidades tipo delegacia) para unidade operacional
	const delegacias = $derived(todasUnidades.filter((u: any) => u.tipo === 'delegacia'));
</script>

<div class="space-y-6">
	<!-- Cabeçalho -->
	<div class="flex items-start justify-between flex-wrap gap-3">
		<div>
			<button
				class="text-xs text-surface-500 hover:text-primary-500 transition-colors mb-1 flex items-center gap-1"
				onclick={() => goto('/gise')}
			>
				← Voltar
			</button>
			{#if gise}
				<h1 class="text-2xl font-bold text-surface-900 dark:text-surface-50">
					Escala GISE — {fmtDate(gise.data_inicio)} a {fmtDate(gise.data_fim)}
				</h1>
				<div class="flex items-center gap-2 mt-1">
					<span class="text-xs px-2 py-0.5 rounded-full font-semibold {statusColor(gise.status)}">
						{statusLabel(gise.status)}
					</span>
					<span class="text-xs text-surface-500">{gise.hora_entrada}h às {gise.hora_saida}h</span>
				</div>
			{/if}
		</div>

		<div class="flex items-center gap-2">
			{#if podeFinalizar}
				<button
					class="btn preset-filled-error-500 text-sm px-4 py-2 rounded-xl"
					onclick={() => (showFinalizarConfirm = true)}
				>
					Marcar como Finalizada
				</button>
			{/if}
			{#if podeAssinar}
				<button
					class="btn preset-filled-success-500 text-sm px-4 py-2 rounded-xl"
					onclick={() => (showAssinaConfirm = true)}
				>
					Assinar Digitalmente
				</button>
			{/if}
		</div>
	</div>

	{#if !gise}
		<p class="text-surface-500">Escala não encontrada.</p>
	{:else}
		<!-- Supervisores -->
		<div class="rounded-2xl border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900 p-5">
			<div class="flex items-center justify-between mb-3">
				<h2 class="font-semibold text-surface-900 dark:text-surface-50">Supervisores</h2>
				{#if (isAdminGeral || isSeccional) && podeEditar && !editandoSupervisores}
					<button
						class="text-xs text-primary-600 hover:text-primary-500 transition-colors"
						onclick={() => (editandoSupervisores = true)}
					>
						Editar
					</button>
				{/if}
			</div>

			{#if editandoSupervisores}
				<div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
					<div>
						<label class="text-xs font-medium text-surface-600 dark:text-surface-400 block mb-1">Supervisor Sábado (DPC)</label>
						<select
							bind:value={supSabadoId}
							class="w-full px-3 py-2 rounded-xl border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-800 text-sm"
						>
							<option value={null}>Não definido</option>
							{#each dpcs as p}
								<option value={p.id}>{p.nome} ({p.matricula})</option>
							{/each}
						</select>
					</div>
					<div>
						<label class="text-xs font-medium text-surface-600 dark:text-surface-400 block mb-1">Supervisor Domingo (DPC)</label>
						<select
							bind:value={supDomingoId}
							class="w-full px-3 py-2 rounded-xl border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-800 text-sm"
						>
							<option value={null}>Não definido</option>
							{#each dpcs as p}
								<option value={p.id}>{p.nome} ({p.matricula})</option>
							{/each}
						</select>
					</div>
				</div>
				<div class="flex gap-2">
					<button
						class="btn preset-filled-primary-500 text-xs px-3 py-1.5 rounded-lg"
						onclick={salvarSupervisores}
						disabled={salvando}
					>
						{salvando ? 'Salvando...' : 'Salvar'}
					</button>
					<button
						class="btn preset-tonal-surface text-xs px-3 py-1.5 rounded-lg"
						onclick={() => (editandoSupervisores = false)}
					>
						Cancelar
					</button>
				</div>
			{:else}
				<div class="grid grid-cols-2 gap-4 text-sm">
					<div>
						<p class="text-xs text-surface-500 mb-0.5">Sábado</p>
						<p class="font-medium text-surface-900 dark:text-surface-100">
							{gise.supervisor_sabado_nome ?? '—'}
						</p>
					</div>
					<div>
						<p class="text-xs text-surface-500 mb-0.5">Domingo</p>
						<p class="font-medium text-surface-900 dark:text-surface-100">
							{gise.supervisor_domingo_nome ?? '—'}
						</p>
					</div>
				</div>
			{/if}
		</div>

		<!-- Seccionais -->
		<div>
			<h2 class="font-semibold text-surface-900 dark:text-surface-50 mb-3">
				Seccionais ({gise.seccionais?.length ?? 0})
			</h2>

			{#each (gise.seccionais ?? []) as sec}
				<!-- Mostrar só a seccional do Admin Seccional, ou todas para Admin Geral / Supervisor -->
				{#if isAdminGeral || isSupervisor || sec.seccional_id === minhaSeccionalId}
					<div class="rounded-2xl border border-surface-200 dark:border-surface-800 mb-4 overflow-hidden">
						<!-- Cabeçalho da seccional -->
						<div class="flex items-center justify-between px-5 py-3 bg-surface-100 dark:bg-surface-800">
							<div class="flex items-center gap-3">
								<span class="font-semibold text-surface-900 dark:text-surface-50 text-sm">
									{sec.seccional_nome}
								</span>
								<span class="text-[0.65rem] px-1.5 py-0.5 rounded-full font-bold {sec.status === 'preenchida' ? 'bg-success-500/20 text-success-700 dark:text-success-400' : 'bg-warning-500/20 text-warning-600 dark:text-warning-400'}">
									{sec.status === 'preenchida' ? 'Preenchida' : 'Pendente'}
								</span>
							</div>

							<!-- Finalizar seccional (Admin Seccional) -->
							{#if (isSeccional && sec.seccional_id === minhaSeccionalId || isAdminGeral) && sec.status === 'pendente' && podeEditar}
								<button
									class="text-xs btn preset-tonal-success px-3 py-1 rounded-lg"
									onclick={() => finalizarSeccional(sec.id)}
									disabled={salvando}
								>
									Finalizar envio
								</button>
							{/if}
						</div>

						<div class="p-5 space-y-4">
							<!-- Unidade Operacional -->
							{#if isSeccional && sec.seccional_id === minhaSeccionalId && podeEditar}
								<div>
									<label class="text-xs font-medium text-surface-600 dark:text-surface-400 block mb-1">
										Unidade Operacional
									</label>
									<div class="flex gap-2">
										<select
											bind:value={unidadeOperacionalId}
											class="flex-1 px-3 py-2 rounded-xl border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-800 text-sm"
										>
											<option value={null}>Selecionar unidade...</option>
											{#each delegacias as u}
												<option value={u.id}>{u.nome}</option>
											{/each}
										</select>
										<button
											class="btn preset-filled-primary-500 text-xs px-3 py-1.5 rounded-xl"
											onclick={() => salvarUnidadeOperacional(sec.id)}
											disabled={salvando}
										>
											Salvar
										</button>
									</div>
								</div>
							{:else if sec.unidade_operacional_nome}
								<p class="text-xs text-surface-500">
									Unidade Operacional: <span class="font-semibold text-surface-900 dark:text-surface-100">{sec.unidade_operacional_nome}</span>
								</p>
							{/if}

							<!-- Equipes -->
							{#each (sec.equipes ?? []) as equipe}
								<div class="rounded-xl border border-surface-200 dark:border-surface-700 p-4">
									<div class="flex items-center justify-between mb-3">
										<div>
											<span class="text-sm font-semibold text-surface-900 dark:text-surface-100 capitalize">
												Equipe {equipe.tipo === 'operacional' ? 'Operacional' : 'SEINT'}
											</span>
											<span class="ml-2 text-xs text-surface-500">
												{equipe.slots_dpc} DPC + {equipe.slots_oip} OIP
											</span>
										</div>
										{#if isAdminGeral && podeEditar}
											<button
												class="text-xs text-error-600 hover:text-error-500"
												onclick={async () => {
													const r = await fetch(`/api/gise/${gise.id}/equipes/${equipe.id}`, { method: 'DELETE' });
													if (r.ok) { toaster.success({ title: 'Equipe removida' }); await invalidateAll(); }
													else { const j = await r.json(); toaster.error({ title: j.error }); }
												}}
											>
												Remover equipe
											</button>
										{/if}
									</div>

									<!-- Membros -->
									{#if equipe.membros?.length}
										<div class="space-y-1 mb-3">
											{#each equipe.membros as m}
												<div class="flex items-center justify-between text-xs px-3 py-1.5 rounded-lg bg-surface-100 dark:bg-surface-800">
													<div class="flex items-center gap-2">
														<span class="font-semibold text-surface-900 dark:text-surface-100">{m.policial_nome}</span>
														<span class="text-surface-500">{m.policial_cargo} · {m.policial_matricula}</span>
														<span class="text-[0.6rem] px-1 py-0.5 rounded bg-surface-200 dark:bg-surface-700 text-surface-600 dark:text-surface-400 capitalize">{m.dia}</span>
													</div>
													{#if podeEditar && (isAdminGeral || (isSeccional && sec.seccional_id === minhaSeccionalId))}
														<button
															class="text-error-500 hover:text-error-400 transition-colors"
															onclick={() => removerMembro(m.id)}
														>×</button>
													{/if}
												</div>
											{/each}
										</div>
									{:else}
										<p class="text-xs text-surface-400 italic mb-3">Nenhum membro alocado</p>
									{/if}

									<!-- Adicionar membro -->
									{#if podeEditar && (isAdminGeral || (isSeccional && sec.seccional_id === minhaSeccionalId))}
										{#if equipeParaAdicionar === equipe.id}
											<div class="flex flex-wrap gap-2 items-end">
												<div class="flex-1 min-w-32">
													<select
														bind:value={policialParaAdicionar}
														class="w-full px-2 py-1.5 rounded-lg border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-800 text-xs"
													>
														<option value="">Selecionar policial...</option>
														{#each policiais as p}
															<option value={p.id}>{p.nome} ({p.cargo} · {p.matricula})</option>
														{/each}
													</select>
												</div>
												<select
													bind:value={diaParaAdicionar}
													class="px-2 py-1.5 rounded-lg border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-800 text-xs"
												>
													<option value="ambos">Sáb + Dom</option>
													<option value="sabado">Só Sáb</option>
													<option value="domingo">Só Dom</option>
												</select>
												<button
													class="btn preset-filled-primary-500 text-xs px-2 py-1.5 rounded-lg"
													onclick={() => adicionarMembro(sec.id)}
													disabled={!policialParaAdicionar || salvando}
												>Adicionar</button>
												<button
													class="btn preset-tonal-surface text-xs px-2 py-1.5 rounded-lg"
													onclick={() => { equipeParaAdicionar = null; policialParaAdicionar = ''; }}
												>×</button>
											</div>
										{:else}
											<button
												class="text-xs text-primary-600 hover:text-primary-500 transition-colors"
												onclick={() => { equipeParaAdicionar = equipe.id; policialParaAdicionar = ''; }}
											>
												+ Adicionar policial
											</button>
										{/if}
									{/if}
								</div>
							{/each}
						</div>
					</div>
				{/if}
			{/each}
		</div>

		<!-- Assinatura (Supervisor) -->
		{#if isSupervisor && gise.status === 'em_preenchimento'}
			<div class="rounded-2xl border border-warning-500/30 bg-warning-500/5 p-5 text-center">
				<p class="text-warning-700 dark:text-warning-400 text-sm font-medium">
					A escala ainda não está concluída pelas seccionais.
				</p>
			</div>
		{/if}

		<!-- Info de assinatura -->
		{#if gise.documento}
			<div class="rounded-2xl border border-success-500/30 bg-success-500/5 p-5">
				<p class="text-success-700 dark:text-success-400 font-semibold text-sm">Escala Assinada</p>
				<p class="text-xs text-surface-500 mt-1">Por: {gise.documento.assinante_nome}</p>
				{#if gise.documento.verificacao_hash}
					<p class="text-xs font-mono text-surface-400 mt-1 break-all">
						Hash: {gise.documento.verificacao_hash}
					</p>
				{/if}
			</div>
		{/if}
	{/if}
</div>

<!-- Confirmar Assinar -->
{#if showAssinaConfirm}
	<div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
		<div class="bg-surface-50 dark:bg-surface-900 rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
			<h2 class="text-lg font-bold text-surface-900 dark:text-surface-50">Assinar Escala GISE</h2>
			<p class="text-sm text-surface-600 dark:text-surface-400">
				Ao assinar, você confirma que os dados da escala estão corretos. Esta ação não pode ser desfeita.
			</p>
			<div class="flex justify-end gap-3">
				<button class="btn preset-tonal-surface text-sm px-4 py-2 rounded-xl" onclick={() => (showAssinaConfirm = false)}>
					Cancelar
				</button>
				<button
					class="btn preset-filled-success-500 text-sm px-4 py-2 rounded-xl"
					onclick={assinarEscala}
					disabled={assinando}
				>
					{assinando ? 'Assinando...' : 'Confirmar Assinatura'}
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- Confirmar Finalizar -->
{#if showFinalizarConfirm}
	<div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
		<div class="bg-surface-50 dark:bg-surface-900 rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
			<h2 class="text-lg font-bold text-surface-900 dark:text-surface-50">Finalizar Escala GISE</h2>
			<p class="text-sm text-surface-600 dark:text-surface-400">
				A escala será marcada como <strong>Finalizada</strong> e o sistema criará automaticamente a escala do próximo final de semana.
			</p>
			<div class="flex justify-end gap-3">
				<button class="btn preset-tonal-surface text-sm px-4 py-2 rounded-xl" onclick={() => (showFinalizarConfirm = false)}>
					Cancelar
				</button>
				<button
					class="btn preset-filled-error-500 text-sm px-4 py-2 rounded-xl"
					onclick={finalizarGise}
					disabled={finalizando}
				>
					{finalizando ? 'Finalizando...' : 'Confirmar'}
				</button>
			</div>
		</div>
	</div>
{/if}
