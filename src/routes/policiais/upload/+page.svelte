<script lang="ts">
	/* eslint-disable svelte/no-navigation-without-resolve */
	import { toaster } from '$lib/toast';
	import { csrfHeaders } from '$lib/csrf';
	import { loading } from '$lib/loading.svelte';
	import { Accordion } from '@skeletonlabs/skeleton-svelte';
	import type { ActionResult } from '@sveltejs/kit';

	let file = $state<File | null>(null);
	let result = $state<{
		imported: number;
		skipped: number;
		errors: { row: number; nome: string; message: string }[];
		total: number;
	} | null>(null);

	import { enhance } from '$app/forms';

	function onFileChange(e: Event) {
		const input = e.target as HTMLInputElement;
		file = input.files?.[0] || null;
		result = null;
	}

	function handleUpload() {
		if (!file) return;

		loading.show('Enviando e processando planilha...');
		result = null;

		return async ({ result: actionResult }: { result: ActionResult }) => {
			loading.hide();
			if (actionResult.type === 'success') {
				result = actionResult.data as typeof result;
				toaster.create({
					title: `${result?.imported} policial${result?.imported !== 1 ? 'is' : ''} importado${result?.imported !== 1 ? 's' : ''} com sucesso!`,
					type: 'success'
				});
			} else if (actionResult.type === 'failure') {
				const d = actionResult.data as Record<string, unknown> | undefined;
				toaster.create({
					title: String(d?.error || 'Erro desconhecido ao processar o arquivo.'),
					type: 'error'
				});
			} else {
				toaster.create({
					title: 'Ocorreu um erro no servidor ao processar o arquivo.',
					type: 'error'
				});
			}
		};
	}
</script>

<div class="flex items-center justify-between mb-6">
	<h1 class="h1 text-2xl font-bold">Importar Planilha</h1>
	<a href="/policiais" class="btn preset-outlined-primary-500">Voltar</a>
</div>

<div
	class="card-glass p-4 sm:p-6 mb-4 rounded-3xl"
>
	<!-- Format instructions -->
	<div
		class="bg-surface-100/50 dark:bg-surface-800 border border-surface-200 dark:border-white/10 rounded-lg p-4 mb-6"
	>
		<p class="font-medium text-sm mb-2">Formato esperado da planilha:</p>
		<div class="table-wrap">
			<table class="table">
				<thead>
					<tr>
						<th>Coluna A</th>
						<th>Coluna B</th>
						<th>Coluna C</th>
						<th>Coluna D</th>
						<th>Coluna E</th>
					</tr>
				</thead>
				<tbody>
					<tr>
						<td class="font-medium">Nome *</td>
						<td class="font-medium">Matrícula *</td>
						<td class="font-medium">Cargo *</td>
						<td class="font-medium">Telefone</td>
						<td class="font-medium">Lotação *</td>
					</tr>
					<tr class="text-surface-500 italic">
						<td>João Silva</td>
						<td>12345</td>
						<td>DPC</td>
						<td>(99) 99999-9999</td>
						<td>1ª DP</td>
					</tr>
				</tbody>
			</table>
		</div>
		<p class="text-xs text-surface-500 mt-2">
			* Campos obrigatórios. A primeira linha (cabeçalho) será ignorada. Cargo deve ser <strong
				>DPC</strong
			>
			ou <strong>OIP</strong>.
		</p>
	</div>

	{#if result}
		<div class="mb-6">
			<!-- Summary cards -->
			<div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
				<div class="text-center p-3 rounded-lg bg-surface-200">
					<div class="text-2xl font-bold">{result.total}</div>
					<div class="text-xs text-surface-500">Total de linhas</div>
				</div>
				<div class="text-center p-3 rounded-lg preset-tonal-success">
					<div class="text-2xl font-bold">{result.imported}</div>
					<div class="text-xs">Importados</div>
				</div>
				{#if result.skipped > 0}
					<div class="text-center p-3 rounded-lg preset-tonal-warning">
						<div class="text-2xl font-bold">{result.skipped}</div>
						<div class="text-xs">Já existentes</div>
					</div>
				{/if}
				{#if result.errors.length - result.skipped > 0}
					<div class="text-center p-3 rounded-lg preset-tonal-error">
						<div class="text-2xl font-bold">{result.errors.length - result.skipped}</div>
						<div class="text-xs">Com erro</div>
					</div>
				{/if}
			</div>

			{#if result.errors.length > 0}
				<Accordion
					defaultValue={result.imported === 0 ? ['errors'] : []}
					collapsible
					class="border border-surface-200 dark:border-white/10 rounded-lg overflow-hidden"
				>
					<Accordion.Item value="errors">
						<Accordion.ItemTrigger
							class="w-full px-4 py-3 cursor-pointer preset-tonal-error text-sm font-medium flex items-center justify-between gap-2"
						>
							<span>
								{result.errors.length} linha{result.errors.length !== 1 ? 's' : ''} com observações
							</span>
							<Accordion.ItemIndicator>
								<svg
									class="w-4 h-4 transition-transform"
									fill="none"
									viewBox="0 0 24 24"
									stroke="currentColor"
								>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M19 9l-7 7-7-7"
									/>
								</svg>
							</Accordion.ItemIndicator>
						</Accordion.ItemTrigger>
						<Accordion.ItemContent>
							<div class="max-h-[300px] overflow-y-auto">
								<table class="table">
									<thead>
										<tr>
											<th>Linha</th>
											<th>Nome</th>
											<th>Problema</th>
										</tr>
									</thead>
									<tbody>
										{#each result.errors as err (err.row)}
											<tr>
												<td class="font-semibold whitespace-nowrap">{err.row}</td>
												<td>{err.nome}</td>
												<td>{err.message}</td>
											</tr>
										{/each}
									</tbody>
								</table>
							</div>
						</Accordion.ItemContent>
					</Accordion.Item>
				</Accordion>
			{/if}
		</div>
	{/if}

	<form
		method="POST"
		action="?/upload"
		use:enhance={handleUpload}
		enctype="multipart/form-data"
		class="space-y-4"
	>
		<label class="label">
			<span class="label-text">Arquivo (.xlsx, .xls, .ods, .csv)</span>
			<input
				name="file"
				class="input"
				type="file"
				accept=".xlsx,.xls,.ods,.csv"
				onchange={onFileChange}
				required
			/>
		</label>
		<button
			type="submit"
			class="btn preset-filled-primary-500 flex items-center gap-2"
			disabled={loading.active || !file}
		>
			{loading.active ? 'Importando...' : 'Importar'}
		</button>
	</form>
</div>
