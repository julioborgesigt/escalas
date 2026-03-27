<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { toaster } from '$lib/toast';

	let { data } = $props();

	const policiais = $derived(data.policiais ?? []);
	const seccionais = $derived(data.seccionais ?? []);
	const todasUnidades = $derived(data.todasUnidades ?? []);
	const isAdminGeral = $derived(data.isAdminGeral ?? false);

	// Busca
	let busca = $state('');
	const policialsFiltrados = $derived(
		busca.trim()
			? policiais.filter((p: any) =>
					p.nome.toLowerCase().includes(busca.toLowerCase()) ||
					p.matricula.includes(busca)
			  )
			: policiais
	);

	// Edição
	let editando = $state<{ id: number; nome: string; papel: string | null; papel_unidade_id: number | null } | null>(null);
	let salvando = $state(false);

	function abrirEdicao(p: any) {
		editando = {
			id: p.id,
			nome: p.nome,
			papel: p.papel ?? null,
			papel_unidade_id: p.papel_unidade_id ?? null
		};
	}

	async function salvarPapel() {
		if (!editando) return;
		salvando = true;
		try {
			const res = await fetch('/api/admin/papeis', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					policial_id: editando.id,
					papel: editando.papel || null,
					papel_unidade_id: editando.papel_unidade_id || null
				})
			});
			const json = await res.json();
			if (!res.ok) throw new Error(json.error);
			toaster.success({ title: 'Papel atualizado' });
			editando = null;
			await invalidateAll();
		} catch (e: any) {
			toaster.error({ title: 'Erro', description: e.message });
		} finally {
			salvando = false;
		}
	}

	function papelLabel(papel: string | null): string {
		if (!papel) return 'Servidor';
		return papel === 'admin_seccional' ? 'Admin Seccional' : 'Admin Unidade';
	}

	function papelColor(papel: string | null): string {
		if (!papel) return 'bg-surface-200/50 text-surface-600 dark:bg-surface-800 dark:text-surface-400';
		if (papel === 'admin_seccional') return 'bg-warning-500/15 text-warning-700 dark:text-warning-400';
		return 'bg-tertiary-500/15 text-tertiary-700 dark:text-tertiary-400';
	}

	// Unidades disponíveis para o papel selecionado
	const unidadesParaPapel = $derived(() => {
		if (!editando?.papel) return [];
		if (editando.papel === 'admin_seccional') return seccionais;
		return todasUnidades;
	});
</script>

<div class="space-y-6">
	<div>
		<h1 class="text-2xl font-bold text-surface-900 dark:text-surface-50">Gerenciar Papéis</h1>
		<p class="text-sm text-surface-500 dark:text-surface-400 mt-0.5">
			Promova ou rebaixe servidores para papéis administrativos.
		</p>
	</div>

	<!-- Regras -->
	<div class="rounded-xl border border-surface-200 dark:border-surface-800 bg-surface-50/50 dark:bg-surface-900/50 p-4 text-xs text-surface-600 dark:text-surface-400 space-y-1">
		<p class="font-semibold text-surface-800 dark:text-surface-200">Regras de promoção:</p>
		<p>• <strong>Admin Geral</strong> pode promover a: Admin Seccional, Admin Unidade</p>
		<p>• <strong>Admin Seccional</strong> pode promover a: Admin Unidade (da sua jurisdição)</p>
		<p>• Supervisor GISE é designado diretamente na escala GISE (somente DPC)</p>
		<p>• Nenhum papel pode promover outro servidor a Supervisor</p>
	</div>

	<!-- Busca -->
	<input
		type="text"
		bind:value={busca}
		placeholder="Buscar por nome ou matrícula..."
		class="w-full px-4 py-2.5 rounded-xl border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-800 text-sm"
	/>

	<!-- Lista -->
	<div class="space-y-2">
		{#each policialsFiltrados as policial}
			<div class="flex items-center justify-between gap-3 px-4 py-3 rounded-xl border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900">
				<div class="flex items-center gap-3 min-w-0">
					<div class="min-w-0">
						<p class="text-sm font-semibold text-surface-900 dark:text-surface-100 truncate">{policial.nome}</p>
						<p class="text-xs text-surface-500">{policial.cargo} · {policial.matricula} · {policial.lotacao}</p>
					</div>
					<span class="text-[0.65rem] px-2 py-0.5 rounded-full font-semibold shrink-0 {papelColor(policial.papel)}">
						{papelLabel(policial.papel)}
					</span>
				</div>
				<button
					class="btn preset-tonal-primary text-xs px-3 py-1.5 rounded-lg shrink-0"
					onclick={() => abrirEdicao(policial)}
				>
					Editar
				</button>
			</div>
		{/each}

		{#if policialsFiltrados.length === 0}
			<p class="text-sm text-surface-500 text-center py-8">Nenhum servidor encontrado.</p>
		{/if}
	</div>
</div>

<!-- Modal edição de papel -->
{#if editando}
	<div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
		<div class="bg-surface-50 dark:bg-surface-900 rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
			<h2 class="text-lg font-bold text-surface-900 dark:text-surface-50">Editar Papel</h2>
			<p class="text-sm text-surface-600 dark:text-surface-400">{editando.nome}</p>

			<div>
				<label class="text-xs font-medium text-surface-600 dark:text-surface-400 block mb-1">Papel</label>
				<select
					bind:value={editando.papel}
					class="w-full px-3 py-2 rounded-xl border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-800 text-sm"
				>
					<option value={null}>Servidor (sem papel)</option>
					{#if isAdminGeral}
						<option value="admin_seccional">Admin Seccional</option>
					{/if}
					<option value="admin_unidade">Admin Unidade</option>
				</select>
			</div>

			{#if editando.papel}
				<div>
					<label class="text-xs font-medium text-surface-600 dark:text-surface-400 block mb-1">
						{editando.papel === 'admin_seccional' ? 'Seccional de responsabilidade' : 'Unidade de responsabilidade'}
					</label>
					<select
						bind:value={editando.papel_unidade_id}
						class="w-full px-3 py-2 rounded-xl border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-800 text-sm"
					>
						<option value={null}>Selecionar...</option>
						{#each (editando.papel === 'admin_seccional' ? seccionais : todasUnidades) as u}
							<option value={u.id}>{u.nome} ({u.tipo})</option>
						{/each}
					</select>
				</div>
			{/if}

			<div class="flex justify-end gap-3 pt-2">
				<button
					class="btn preset-tonal-surface text-sm px-4 py-2 rounded-xl"
					onclick={() => (editando = null)}
				>
					Cancelar
				</button>
				<button
					class="btn preset-filled-primary-500 text-sm px-4 py-2 rounded-xl"
					onclick={salvarPapel}
					disabled={salvando}
				>
					{salvando ? 'Salvando...' : 'Salvar'}
				</button>
			</div>
		</div>
	</div>
{/if}
