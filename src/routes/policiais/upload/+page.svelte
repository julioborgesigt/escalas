<script lang="ts">
	let file = $state<File | null>(null);
	let uploading = $state(false);
	let result = $state<{
		imported: number;
		skipped: number;
		errors: { row: number; nome: string; message: string }[];
		total: number;
	} | null>(null);
	let error = $state('');
	let errorType = $state('');

	function onFileChange(e: Event) {
		const input = e.target as HTMLInputElement;
		file = input.files?.[0] || null;
		result = null;
		error = '';
		errorType = '';
	}

	async function upload(e: Event) {
		e.preventDefault();
		if (!file) return;

		uploading = true;
		error = '';
		errorType = '';
		result = null;

		try {
			const formData = new FormData();
			formData.append('file', file);

			const res = await fetch('/api/policiais/upload', {
				method: 'POST',
				body: formData
			});

			const data = await res.json();

			if (res.ok) {
				result = data;
			} else {
				error = data.error || 'Erro desconhecido ao processar o arquivo.';
				errorType = data.errorType || 'unknown';
			}
		} catch {
			error = 'Erro de conexão. Verifique sua internet e tente novamente.';
			errorType = 'network';
		}
		uploading = false;
	}

	function getErrorHint(type: string) {
		if (type === 'database')
			return 'Dica: No dashboard da Cloudflare, vá em Pages > escalas > Settings > Functions > D1 database bindings e vincule o banco "escalas-db" à variável "DB".';
		if (type === 'parse')
			return 'Dica: Tente abrir o arquivo no Excel/LibreOffice e salvar novamente como .xlsx.';
		return '';
	}
</script>

<div class="flex items-center justify-between mb-6">
	<h1 class="h1 text-xl font-bold">Importar Planilha</h1>
	<a href="/policiais" class="btn preset-outlined-primary-500">Voltar</a>
</div>

<div class="card p-4 sm:p-6">
	<!-- Format instructions -->
	<div class="bg-surface-100 border border-surface-200 rounded-lg p-4 mb-6">
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
			* Campos obrigatórios. A primeira linha (cabeçalho) será ignorada. Cargo deve ser <strong>DPC</strong> ou <strong>OIP</strong>.
		</p>
	</div>

	{#if error}
		<aside class="preset-filled-error-500 p-4 rounded-lg mb-4">
			<strong>{error}</strong>
			{#if getErrorHint(errorType)}
				<p class="mt-2 text-sm opacity-80">{getErrorHint(errorType)}</p>
			{/if}
		</aside>
	{/if}

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

			{#if result.imported > 0}
				<aside class="preset-tonal-success p-3 rounded-lg text-sm mb-4">
					{result.imported} policial{result.imported !== 1 ? 'is' : ''} importado{result.imported !== 1 ? 's' : ''} com sucesso!
				</aside>
			{/if}

			{#if result.errors.length > 0}
				<details class="border border-surface-200 rounded-lg overflow-hidden" open={result.imported === 0}>
					<summary class="px-4 py-3 cursor-pointer preset-tonal-error text-sm font-medium select-none">
						{result.errors.length} linha{result.errors.length !== 1 ? 's' : ''} com observações
					</summary>
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
								{#each result.errors as err}
									<tr>
										<td class="font-semibold whitespace-nowrap">{err.row}</td>
										<td>{err.nome}</td>
										<td>{err.message}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				</details>
			{/if}
		</div>
	{/if}

	<form onsubmit={upload} class="space-y-4">
		<label class="label">
			<span class="label-text">Arquivo (.xlsx, .xls, .ods, .csv)</span>
			<input class="input" type="file" accept=".xlsx,.xls,.ods,.csv" onchange={onFileChange} required />
		</label>
		<button type="submit" class="btn preset-filled-primary-500" disabled={uploading || !file}>
			{#if uploading}
				<span class="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
				Importando...
			{:else}
				Importar
			{/if}
		</button>
	</form>
</div>
