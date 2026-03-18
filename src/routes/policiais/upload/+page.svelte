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
		// Reset previous results when a new file is selected
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

	function getErrorIcon(type: string) {
		if (type === 'database') return '🗄️';
		if (type === 'parse') return '📄';
		if (type === 'validation') return '⚠️';
		if (type === 'network') return '🌐';
		return '❌';
	}

	function getErrorHint(type: string) {
		if (type === 'database')
			return 'Dica: No dashboard da Cloudflare, vá em Pages > escalas > Settings > Functions > D1 database bindings e vincule o banco "escalas-db" à variável "DB".';
		if (type === 'parse')
			return 'Dica: Tente abrir o arquivo no Excel/LibreOffice e salvar novamente como .xlsx.';
		return '';
	}
</script>

<div class="page-header">
	<h1>Importar Planilha</h1>
	<a href="/policiais" class="btn btn-outline">Voltar</a>
</div>

<div class="card">
	<div class="upload-instructions">
		<p><strong>Formato esperado da planilha:</strong></p>
		<table class="format-table">
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
					<td>Nome *</td>
					<td>Matrícula *</td>
					<td>Cargo *</td>
					<td>Telefone</td>
					<td>Lotação *</td>
				</tr>
				<tr class="example-row">
					<td>João Silva</td>
					<td>12345</td>
					<td>DPC</td>
					<td>(99) 99999-9999</td>
					<td>1ª DP</td>
				</tr>
			</tbody>
		</table>
		<p class="instructions-note">
			* Campos obrigatórios. A primeira linha (cabeçalho) será ignorada. Cargo deve ser <strong>DPC</strong> ou <strong>OIP</strong>.
		</p>
	</div>

	{#if error}
		<div class="alert alert-error detailed-error">
			<div class="error-header">
				<span class="error-icon">{getErrorIcon(errorType)}</span>
				<strong>{error}</strong>
			</div>
			{#if getErrorHint(errorType)}
				<p class="error-hint">{getErrorHint(errorType)}</p>
			{/if}
		</div>
	{/if}

	{#if result}
		<div class="import-summary">
			<div class="summary-cards">
				<div class="summary-item summary-total">
					<span class="summary-number">{result.total}</span>
					<span class="summary-label">Total de linhas</span>
				</div>
				<div class="summary-item summary-success">
					<span class="summary-number">{result.imported}</span>
					<span class="summary-label">Importados</span>
				</div>
				{#if result.skipped > 0}
					<div class="summary-item summary-skipped">
						<span class="summary-number">{result.skipped}</span>
						<span class="summary-label">Já existentes</span>
					</div>
				{/if}
				{#if result.errors.length - result.skipped > 0}
					<div class="summary-item summary-error">
						<span class="summary-number">{result.errors.length - result.skipped}</span>
						<span class="summary-label">Com erro</span>
					</div>
				{/if}
			</div>

			{#if result.imported > 0}
				<div class="alert alert-success">
					{result.imported} policial{result.imported !== 1 ? 'is' : ''} importado{result.imported !== 1 ? 's' : ''} com sucesso!
				</div>
			{/if}

			{#if result.errors.length > 0}
				<details class="error-details" open={result.imported === 0}>
					<summary class="error-details-toggle">
						{result.errors.length} linha{result.errors.length !== 1 ? 's' : ''} com observações — clique para {result.imported === 0 ? 'ocultar' : 'ver'} detalhes
					</summary>
					<div class="error-table-wrapper">
						<table class="error-table">
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
										<td class="error-row-num">{err.row}</td>
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

	<form onsubmit={upload}>
		<div class="form-group">
			<label for="file">Arquivo (.xlsx, .xls, .ods, .csv)</label>
			<input id="file" type="file" accept=".xlsx,.xls,.ods,.csv" onchange={onFileChange} required />
		</div>
		<div class="actions">
			<button type="submit" class="btn btn-primary" disabled={uploading || !file}>
				{#if uploading}
					<span class="spinner"></span> Importando...
				{:else}
					Importar
				{/if}
			</button>
		</div>
	</form>
</div>

<style>
	.upload-instructions {
		background: var(--bg-light, #f8f9fa);
		border: 1px solid var(--border, #e2e8f0);
		border-radius: 8px;
		padding: 1rem;
		margin-bottom: 1.5rem;
	}

	.upload-instructions p {
		margin: 0 0 0.5rem;
		font-size: 0.9rem;
		color: var(--text-light, #64748b);
	}

	.format-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.85rem;
		margin-bottom: 0.5rem;
	}

	.format-table th,
	.format-table td {
		border: 1px solid var(--border, #e2e8f0);
		padding: 0.4rem 0.6rem;
		text-align: left;
	}

	.format-table th {
		background: var(--primary, #1a365d);
		color: white;
		font-weight: 600;
	}

	.format-table tbody tr:first-child td {
		font-weight: 500;
	}

	.example-row td {
		color: var(--text-light, #64748b);
		font-style: italic;
	}

	.instructions-note {
		font-size: 0.8rem !important;
		margin-top: 0.5rem !important;
	}

	.detailed-error {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.error-header {
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
	}

	.error-icon {
		font-size: 1.2rem;
		flex-shrink: 0;
	}

	.error-hint {
		margin: 0;
		padding: 0.5rem 0.75rem;
		background: rgba(0, 0, 0, 0.05);
		border-radius: 4px;
		font-size: 0.85rem;
		color: var(--text-light, #64748b);
	}

	.import-summary {
		margin-bottom: 1.5rem;
	}

	.summary-cards {
		display: flex;
		gap: 0.75rem;
		margin-bottom: 1rem;
		flex-wrap: wrap;
	}

	.summary-item {
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 0.75rem 1.25rem;
		border-radius: 8px;
		min-width: 100px;
		flex: 1;
	}

	.summary-number {
		font-size: 1.75rem;
		font-weight: 700;
		line-height: 1;
	}

	.summary-label {
		font-size: 0.8rem;
		margin-top: 0.25rem;
		opacity: 0.8;
	}

	.summary-total {
		background: #e2e8f0;
		color: #334155;
	}

	.summary-success {
		background: #dcfce7;
		color: #166534;
	}

	.summary-skipped {
		background: #fef3c7;
		color: #92400e;
	}

	.summary-error {
		background: #fee2e2;
		color: #991b1b;
	}

	.error-details {
		border: 1px solid var(--border, #e2e8f0);
		border-radius: 8px;
		margin-top: 1rem;
		overflow: hidden;
	}

	.error-details-toggle {
		padding: 0.75rem 1rem;
		cursor: pointer;
		background: #fef2f2;
		color: #991b1b;
		font-size: 0.9rem;
		font-weight: 500;
		user-select: none;
	}

	.error-details-toggle:hover {
		background: #fee2e2;
	}

	.error-table-wrapper {
		max-height: 300px;
		overflow-y: auto;
	}

	.error-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.85rem;
	}

	.error-table th,
	.error-table td {
		border-top: 1px solid var(--border, #e2e8f0);
		padding: 0.5rem 0.75rem;
		text-align: left;
	}

	.error-table th {
		background: #fff5f5;
		font-weight: 600;
		position: sticky;
		top: 0;
	}

	.error-row-num {
		font-weight: 600;
		white-space: nowrap;
	}

	.spinner {
		display: inline-block;
		width: 14px;
		height: 14px;
		border: 2px solid rgba(255, 255, 255, 0.3);
		border-top-color: white;
		border-radius: 50%;
		animation: spin 0.6s linear infinite;
		vertical-align: middle;
		margin-right: 0.25rem;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
